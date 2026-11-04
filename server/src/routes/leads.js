// Staff view of website leads (contact messages and business-plan requests).
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { PLAN_NAMES } = require('../pricing');
const { asyncH, HttpError } = require('../util');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'dispatcher'));

const STATUSES = ['new', 'contacted', 'won', 'closed'];
const serialize = (l) => ({
  id: l.id, type: l.type, name: l.name, company: l.company, email: l.email, phone: l.phone, message: l.message,
  plan: l.plan, planName: l.plan ? PLAN_NAMES[l.plan] || l.plan : null, status: l.status,
  createdAt: l.created_at, updatedAt: l.updated_at, isDemo: l.is_demo,
  // Where the visitor came from: channel (facebook, google_ads, direct…) plus the ad's campaign tag if any.
  source: l.attribution ? { channel: l.attribution.channel, campaign: l.attribution.utm_campaign || null } : null,
});

// Quotes emailed from the website quote box (by a visitor, or by dispatch after a phone call), with
// whether they've booked it yet. Shown on Orders → Quotes.
router.get('/emailed-quotes', asyncH(async (req, res) => {
  const { rows } = await db.query(
    `SELECT q.*, o.order_number, o.status AS order_status, u.name AS account_name, org.name AS company
     FROM quote_locks q LEFT JOIN orders o ON o.id = q.order_id
     LEFT JOIN LATERAL (SELECT name, organization_id FROM users WHERE lower(email) = q.email AND role = 'shipper' LIMIT 1) u ON true
     LEFT JOIN organizations org ON org.id = u.organization_id
     WHERE q.created_at > now() - interval '60 days' ORDER BY q.created_at DESC LIMIT 100`);
  res.json(rows.map((q) => ({
    id: q.id, email: q.email, priceCents: q.price_cents, vehicleType: q.vehicle_type, serviceLevel: q.service_level,
    weightLbs: q.weight_lbs == null ? null : Number(q.weight_lbs), addresses: q.addresses, sentAt: q.created_at, expiresAt: q.expires_at,
    status: q.order_id ? (q.order_status === 'quote' ? 'in_account' : 'booked') : new Date(q.expires_at) < new Date() ? 'expired' : 'open',
    order: q.order_id ? { id: q.order_id, orderNumber: q.order_number } : null,
    account: q.account_name || q.company ? { name: q.account_name, company: q.company } : null,
  })));
}));

// One tap: put the emailed quote in their account at the quoted price and email them a link to it, where
// they add the street addresses and pay.
router.post('/emailed-quotes/:id/send', asyncH(async (req, res) => {
  const locks = require('../quote-locks');
  const orderId = await locks.toAccountQuote(req.params.id, req.user);
  if (!orderId) throw new HttpError(409, "They don't have an account yet, or this quote was already booked.");
  await require('../notify').emailShipper(orderId, 'quote_prepared');
  res.json({ orderId });
}));

router.get('/', asyncH(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.status) {
    params.push(String(req.query.status).split(','));
    where = 'WHERE status = ANY($1)';
  }
  const { rows } = await db.query(`SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT 500`, params);
  res.json(rows.map(serialize));
}));

router.patch('/:id', asyncH(async (req, res) => {
  const status = req.body?.status;
  if (!STATUSES.includes(status)) throw new HttpError(400, `status must be one of: ${STATUSES.join(', ')}`);
  const { rows } = await db.query(
    'UPDATE leads SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [req.params.id, status]
  ).catch(() => ({ rows: [] }));
  if (!rows[0]) throw new HttpError(404, 'Lead not found');
  res.json(serialize(rows[0]));
}));

module.exports = router;
