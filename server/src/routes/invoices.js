// Invoices for companies billed on account. Dispatch: create, send, remind, mark paid, void, and see what
// each company owes. Customers on an account can see their own company's invoices.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, isStaff } = require('../auth');
const { asyncH, HttpError, str } = require('../util');
const inv = require('../invoices');

const router = express.Router();
router.use(requireAuth);
const staffOnly = requireRole('admin', 'dispatcher');

// One invoice the user may see (dispatch: any; a customer: their company's).
async function visible(req) {
  const invoice = await inv.getInvoice('id', req.params.id);
  if (!invoice || (!isStaff(req.user) && (req.user.role !== 'shipper' || req.user.organization_id !== invoice.organizationId))) {
    throw new HttpError(404, 'Invoice not found');
  }
  return invoice;
}

router.get('/', requireRole('shipper', 'admin', 'dispatcher'), asyncH(async (req, res) => {
  const organizationId = isStaff(req.user) ? (str(req.query.organizationId) || null) : req.user.organization_id;
  res.json(await inv.listInvoices({ organizationId }));
}));

router.get('/accounts', staffOnly, asyncH(async (req, res) => {
  const { rows: [s] } = await db.query("SELECT value FROM settings WHERE key = 'invoicing'");
  res.json({ accounts: await inv.accounts(), payInstructions: s?.value?.payInstructions || '' });
}));

// What a company's next invoice would hold, through a date (default today).
router.get('/preview', staffOnly, asyncH(async (req, res) => {
  const through = /^\d{4}-\d{2}-\d{2}$/.test(str(req.query.through)) ? str(req.query.through) : inv.localDate();
  const { lines, totalCents } = await inv.unbilledItems(db, str(req.query.organizationId), through);
  res.json({ through, lines, totalCents });
}));

// Check, ACH and remit-to details printed on every invoice.
router.put('/settings', staffOnly, asyncH(async (req, res) => {
  const payInstructions = str(req.body?.payInstructions).slice(0, 1000);
  await db.query(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('invoicing', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify({ payInstructions }), req.user.id]);
  res.json({ payInstructions });
}));

router.post('/', staffOnly, asyncH(async (req, res) => {
  const organizationId = str(req.body?.organizationId);
  if (!organizationId) throw new HttpError(400, 'organizationId is required');
  const through = /^\d{4}-\d{2}-\d{2}$/.test(str(req.body?.through)) ? str(req.body.through) : inv.localDate();
  const id = await db.withTx((client) => inv.createInvoice(client, organizationId, { through, actorId: req.user.id }));
  if (!id) throw new HttpError(409, 'Nothing to invoice: no delivered orders or charges billed to this account yet');
  res.status(201).json(await inv.getInvoice('id', id));
}));

// Invoice every company billed on account for last month (what the 1st-of-the-month run does).
router.post('/run-monthly', staffOnly, asyncH(async (req, res) => {
  const made = await inv.runMonthly(new Date(), { force: true });
  res.json({ created: made || [] });
}));

router.get('/:id', requireRole('shipper', 'admin', 'dispatcher'), asyncH(async (req, res) => {
  res.json(await visible(req));
}));

// Email it (to the company's billing email unless another address is given). reminder: true for a past-due nudge.
router.post('/:id/send', staffOnly, asyncH(async (req, res) => {
  const invoice = await visible(req);
  if (invoice.status === 'void') throw new HttpError(409, 'This invoice was voided');
  const to = str(req.body?.to).toLowerCase() || invoice.billingEmail;
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new HttpError(400, "Enter the email to send it to (or add a billing email for the company)");
  }
  const reminder = req.body?.reminder === true;
  await inv.emailInvoice(invoice, { to, reminder });
  await db.query(reminder ? 'UPDATE invoices SET reminded_at = now() WHERE id = $1' : 'UPDATE invoices SET sent_at = now(), sent_to = $2 WHERE id = $1',
    reminder ? [invoice.id] : [invoice.id, to]);
  res.json(await inv.getInvoice('id', invoice.id));
}));

router.post('/:id/paid', staffOnly, asyncH(async (req, res) => {
  const invoice = await visible(req);
  await db.withTx((client) => inv.markPaid(client, invoice.id, { method: str(req.body?.method), note: req.body?.note, actorId: req.user.id }));
  res.json(await inv.getInvoice('id', invoice.id));
}));

router.post('/:id/void', staffOnly, asyncH(async (req, res) => {
  const invoice = await visible(req);
  await db.withTx((client) => inv.voidInvoice(client, invoice.id));
  res.json(await inv.getInvoice('id', invoice.id));
}));

module.exports = router;
