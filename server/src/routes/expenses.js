// The owner's business expenses, with receipts, and a month-by-month view of what came in, what went to
// drivers and what was spent. Admin only.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { asyncH, HttpError, str } = require('../util');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const CATEGORIES = {
  fuel: 'Fuel', vehicle: 'Vehicle repairs & maintenance', insurance: 'Insurance', phone: 'Phone & internet',
  supplies: 'Supplies & equipment', software: 'Software & subscriptions', tolls: 'Tolls & parking',
  advertising: 'Advertising & marketing', fees: 'Payment processing & bank fees', licenses: 'Licenses, permits & registration',
  meals: 'Meals', professional: 'Accounting & legal', other: 'Other',
};
const TIME_ZONE = 'America/New_York';

const serialize = (e) => ({
  id: e.id, day: e.day, cents: e.cents,
  category: e.category, categoryLabel: CATEGORIES[e.category] || e.category, vendor: e.vendor, note: e.note,
  hasReceipt: !!e.has_receipt, createdAt: e.created_at,
});

function clean(b, current = {}) {
  const day = b.day === undefined ? current.day : str(b.day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) throw new HttpError(400, 'Enter the date');
  const cents = b.cents === undefined ? current.cents : Math.round(Number(b.cents));
  if (!Number.isFinite(cents) || cents <= 0 || cents > 10000000) throw new HttpError(400, 'Enter the amount');
  const category = b.category === undefined ? current.category : str(b.category);
  if (!CATEGORIES[category]) throw new HttpError(400, 'Choose a category');
  let receipt;
  if (b.receipt !== undefined) {
    receipt = b.receipt ? String(b.receipt) : null;
    if (receipt && (!/^data:(image\/(jpeg|png|webp)|application\/pdf);base64,/.test(receipt) || receipt.length > 4 * 1024 * 1024)) {
      throw new HttpError(400, 'The receipt has to be a photo or PDF under 3 MB');
    }
  }
  return {
    day, cents, category,
    vendor: b.vendor === undefined ? current.vendor || '' : str(b.vendor).slice(0, 120),
    note: b.note === undefined ? current.note || '' : str(b.note).slice(0, 500),
    receipt,
  };
}

router.get('/', asyncH(async (req, res) => {
  const year = Number(req.query.year) || Number(new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, year: 'numeric' }).format(new Date()));
  const { rows } = await db.query(
    `SELECT id, to_char(day, 'YYYY-MM-DD') AS day, cents, category, vendor, note, created_at, receipt IS NOT NULL AS has_receipt
     FROM expenses WHERE extract(year FROM day) = $1 ORDER BY day DESC, created_at DESC`, [year]);
  // Money in: only money actually collected or billed. Card payments (less refunds), deliveries on a
  // monthly invoice account, and extra charges paid or billed to an account. Orders dispatch booked and
  // never marked paid (like test runs) don't count until they're marked paid. Driver pay counts for those
  // same orders, or once it's actually been paid out.
  const { rows: months } = await db.query(
    `WITH counted AS (
       SELECT o.id, o.completed_at, o.driver_pay_cents, o.driver_paid_at,
         CASE WHEN o.payment_status = 'paid' THEN GREATEST(COALESCE(o.paid_cents, o.price_cents) - COALESCE(o.refunded_cents, 0), 0)
              WHEN o.payment_status = 'invoice' AND org.billing_mode = 'invoice' THEN o.price_cents
              ELSE 0 END AS in_cents
       FROM orders o LEFT JOIN organizations org ON org.id = o.organization_id
       WHERE o.status = 'completed' AND NOT o.is_demo AND NOT o.is_test
     )
     SELECT to_char(m, 'YYYY-MM') AS month,
       COALESCE((SELECT sum(in_cents) FROM counted
         WHERE date_trunc('month', completed_at AT TIME ZONE '${TIME_ZONE}') = m), 0)::int
     + COALESCE((SELECT sum(c.cents) FROM order_charges c JOIN orders o ON o.id = c.order_id
         LEFT JOIN organizations org ON org.id = o.organization_id
         WHERE NOT o.is_demo AND NOT o.is_test AND (c.status = 'paid' OR (c.status = 'invoice' AND org.billing_mode = 'invoice'))
           AND date_trunc('month', c.created_at AT TIME ZONE '${TIME_ZONE}') = m), 0)::int AS revenue_cents,
       COALESCE((SELECT sum(driver_pay_cents) FROM counted
         WHERE (in_cents > 0 OR driver_paid_at IS NOT NULL)
           AND date_trunc('month', completed_at AT TIME ZONE '${TIME_ZONE}') = m), 0)::int AS driver_pay_cents,
       COALESCE((SELECT sum(cents) FROM expenses WHERE date_trunc('month', day) = m), 0)::int AS expense_cents
     FROM generate_series(make_date($1, 1, 1)::timestamp, make_date($1, 12, 1)::timestamp, interval '1 month') AS m
     ORDER BY m`, [year]);
  const byCategory = {};
  for (const e of rows) byCategory[e.category] = (byCategory[e.category] || 0) + e.cents;
  res.json({
    year,
    categories: CATEGORIES,
    expenses: rows.map(serialize),
    byCategory: Object.entries(byCategory).map(([k, cents]) => ({ category: k, label: CATEGORIES[k] || k, cents })).sort((a, b) => b.cents - a.cents),
    months: months.map((m) => ({
      month: m.month, revenueCents: m.revenue_cents, driverPayCents: m.driver_pay_cents, expenseCents: m.expense_cents,
      netCents: m.revenue_cents - m.driver_pay_cents - m.expense_cents,
    })),
  });
}));

// "Everything so far was testing": marks every order booked up to now as a test, so it's left out of the
// report. Real orders after this count as usual; one order can be switched back on its page.
router.post('/mark-tests', asyncH(async (req, res) => {
  const { rowCount } = await db.query('UPDATE orders SET is_test = true WHERE NOT is_test AND created_at <= now()');
  res.json({ marked: rowCount });
}));

router.post('/', asyncH(async (req, res) => {
  const e = clean(req.body || {});
  const { rows: [row] } = await db.query(
    `INSERT INTO expenses (day, cents, category, vendor, note, receipt, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, to_char(day, 'YYYY-MM-DD') AS day, cents, category, vendor, note, created_at, receipt IS NOT NULL AS has_receipt`,
    [e.day, e.cents, e.category, e.vendor, e.note, e.receipt || null, req.user.id]);
  res.status(201).json(serialize(row));
}));

router.patch('/:id', asyncH(async (req, res) => {
  const { rows: [cur] } = await db.query("SELECT *, to_char(day, 'YYYY-MM-DD') AS day FROM expenses WHERE id = $1", [req.params.id])
    .catch(() => ({ rows: [] }));
  if (!cur) throw new HttpError(404, 'Expense not found');
  const e = clean(req.body || {}, cur);
  const { rows: [row] } = await db.query(
    `UPDATE expenses SET day = $2, cents = $3, category = $4, vendor = $5, note = $6,
       receipt = CASE WHEN $7::boolean THEN $8 ELSE receipt END WHERE id = $1
     RETURNING id, to_char(day, 'YYYY-MM-DD') AS day, cents, category, vendor, note, created_at, receipt IS NOT NULL AS has_receipt`,
    [cur.id, e.day, e.cents, e.category, e.vendor, e.note, e.receipt !== undefined, e.receipt || null]);
  res.json(serialize(row));
}));

router.delete('/:id', asyncH(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM expenses WHERE id = $1', [req.params.id]).catch(() => ({ rowCount: 0 }));
  if (!rowCount) throw new HttpError(404, 'Expense not found');
  res.status(204).end();
}));

router.get('/:id/receipt', asyncH(async (req, res) => {
  const { rows: [e] } = await db.query('SELECT receipt FROM expenses WHERE id = $1', [req.params.id]).catch(() => ({ rows: [] }));
  if (!e?.receipt) throw new HttpError(404, 'No receipt on this expense');
  res.json({ receipt: e.receipt });
}));

module.exports = router;
