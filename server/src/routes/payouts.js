// Driver pay: what each driver has earned on completed orders, and paying it. Drivers who've set up
// direct deposit (a Stripe Express account) are paid with a Stripe transfer to their bank; anyone can
// also be marked paid by hand (Cash App, Zelle, check). Every payout is recorded with its orders.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, isStaff } = require('../auth');
const { asyncH, HttpError } = require('../util');
const { recordEvent } = require('../orders');
const stripe = require('../stripe');

const router = express.Router();
router.use(requireAuth);

const ORDER_COLS = `o.id, o.order_number, o.completed_at, o.driver_pay_cents, o.driver_paid_at, o.driver_id,
  p.method AS payout_method,
  (SELECT address FROM stops s WHERE s.order_id = o.id ORDER BY sequence LIMIT 1) AS pickup,
  (SELECT address FROM stops s WHERE s.order_id = o.id ORDER BY sequence DESC LIMIT 1) AS dropoff`;
const serialize = (r) => ({
  id: r.id, orderNumber: r.order_number, completedAt: r.completed_at, driverPayCents: r.driver_pay_cents ?? 0,
  driverPaidAt: r.driver_paid_at, payoutMethod: r.payout_method || null, pickup: r.pickup, dropoff: r.dropoff,
});
const sum = (list) => list.reduce((n, o) => n + (o.driverPayCents || 0), 0);
const base = () => String(process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com').replace(/\/$/, '');

// Re-reads a driver's Stripe account and saves whether payouts are on. Returns the saved flags.
async function syncStripeAccount(user) {
  if (!user.stripe_account_id || !stripe.enabled()) {
    return { payoutsEnabled: !!user.stripe_payouts_enabled, detailsSubmitted: !!user.stripe_details_submitted };
  }
  const acct = await stripe.getAccount(user.stripe_account_id);
  const flags = { payoutsEnabled: !!acct.payouts_enabled, detailsSubmitted: !!acct.details_submitted };
  await db.query('UPDATE users SET stripe_payouts_enabled = $2, stripe_details_submitted = $3 WHERE id = $1',
    [user.id, flags.payoutsEnabled, flags.detailsSubmitted]);
  return flags;
}

const stripeStatus = (u, flags = { payoutsEnabled: u.stripe_payouts_enabled, detailsSubmitted: u.stripe_details_submitted }) => ({
  available: stripe.enabled(),
  connected: !!u.stripe_account_id,
  payoutsEnabled: !!flags.payoutsEnabled,
  detailsSubmitted: !!flags.detailsSubmitted,
});

const connectError = (e) => {
  if (/signed up for Connect|platform profile|Connect/i.test(e.message)) {
    return new HttpError(503, 'Direct deposit isn\'t switched on in Stripe yet. Ask Choice Delivery to finish setting up Stripe Connect.');
  }
  return e;
};

// Staff: every driver with completed orders not yet paid out (status=unpaid, default), or paid in the
// last 60 days (status=paid), with whether each driver can be paid through Stripe.
router.get('/', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const paid = req.query.status === 'paid';
  const { rows } = await db.query(
    `SELECT ${ORDER_COLS}, u.name AS driver_name, u.email AS driver_email, u.phone_number AS driver_phone,
            u.stripe_account_id, u.stripe_payouts_enabled, u.stripe_details_submitted
     FROM orders o JOIN users u ON u.id = o.driver_id LEFT JOIN driver_payouts p ON p.id = o.driver_payout_id
     WHERE o.status = 'completed' AND NOT o.is_demo AND ${paid ? "o.driver_paid_at > now() - interval '60 days'" : 'o.driver_paid_at IS NULL'}
     ORDER BY u.name, o.completed_at`);
  const drivers = new Map();
  for (const r of rows) {
    if (!drivers.has(r.driver_id)) {
      drivers.set(r.driver_id, {
        driver: { id: r.driver_id, name: r.driver_name, email: r.driver_email, phoneNumber: r.driver_phone },
        stripe: stripeStatus(r), orders: [],
      });
    }
    drivers.get(r.driver_id).orders.push(serialize(r));
  }
  // Drivers part-way through Stripe sign-up: check whether they've finished since.
  if (!paid) {
    await Promise.all([...drivers.entries()].map(async ([id, d]) => {
      const r = rows.find((x) => x.driver_id === id);
      if (r.stripe_account_id && !r.stripe_payouts_enabled) {
        try { d.stripe = stripeStatus(r, await syncStripeAccount({ ...r, id })); } catch { /* keep the saved status */ }
      }
    }));
  }
  res.json([...drivers.values()].map((d) => ({ ...d, totalCents: sum(d.orders) })));
}));

// Locks the given completed, unpaid orders and checks they all belong to one driver.
async function lockUnpaid(client, orderIds) {
  const ids = Array.isArray(orderIds) ? orderIds.filter((x) => typeof x === 'string').slice(0, 500) : [];
  if (!ids.length) throw new HttpError(400, 'Choose at least one order');
  let rows;
  try {
    ({ rows } = await client.query(
      `SELECT id, driver_id, driver_pay_cents, order_number FROM orders
       WHERE id = ANY($1::uuid[]) AND status = 'completed' AND driver_paid_at IS NULL AND driver_id IS NOT NULL
       FOR UPDATE`, [ids]));
  } catch (e) {
    if (e.code === '22P02') throw new HttpError(400, 'Invalid order id');
    throw e;
  }
  return rows;
}

async function settle(client, rows, payout, actorId) {
  await client.query(
    `UPDATE orders SET driver_paid_at = now(), driver_paid_by = $2, driver_payout_id = $3 WHERE id = ANY($1::uuid[])`,
    [rows.map((r) => r.id), actorId, payout.id]);
  for (const r of rows) {
    await recordEvent(client, r.id, actorId, 'driver_paid', { cents: r.driver_pay_cents, method: payout.method });
  }
}

const insertPayout = (client, driverId, cents, method, actorId) => client.query(
  `INSERT INTO driver_payouts (driver_id, cents, method, created_by) VALUES ($1, $2, $3, $4) RETURNING id, method`,
  [driverId, cents, method, actorId]).then((r) => r.rows[0]);

// Staff: mark orders' driver pay as paid outside the app (one payout record per driver). Body: { orderIds }.
router.post('/mark-paid', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const result = await db.withTx(async (client) => {
    const rows = await lockUnpaid(client, req.body?.orderIds);
    const byDriver = new Map();
    for (const r of rows) byDriver.set(r.driver_id, [...(byDriver.get(r.driver_id) || []), r]);
    for (const [driverId, list] of byDriver) {
      const payout = await insertPayout(client, driverId, list.reduce((n, r) => n + (r.driver_pay_cents || 0), 0), 'manual', req.user.id);
      await settle(client, list, payout, req.user.id);
    }
    return rows;
  });
  res.json({ paidOrders: result.length, totalCents: result.reduce((n, r) => n + (r.driver_pay_cents || 0), 0) });
}));

// Staff: pay a driver's orders through Stripe (a transfer to their direct-deposit account).
// Body: { orderIds } — all for the same driver. Nothing is marked paid unless Stripe accepts it.
router.post('/pay-stripe', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  if (!stripe.enabled()) throw new HttpError(409, 'Stripe is not set up');
  const result = await db.withTx(async (client) => {
    const rows = await lockUnpaid(client, req.body?.orderIds);
    if (!rows.length) throw new HttpError(409, 'These orders were already paid');
    const driverIds = [...new Set(rows.map((r) => r.driver_id))];
    if (driverIds.length > 1) throw new HttpError(400, 'Pay one driver at a time');
    const { rows: [driver] } = await client.query(
      'SELECT id, name, stripe_account_id, stripe_payouts_enabled, stripe_details_submitted FROM users WHERE id = $1', [driverIds[0]]);
    if (!driver.stripe_account_id) throw new HttpError(409, `${driver.name || 'This driver'} hasn't set up direct deposit yet`);
    if (!driver.stripe_payouts_enabled) {
      const flags = await syncStripeAccount(driver).catch(() => ({}));
      if (!flags.payoutsEnabled) {
        throw new HttpError(409, `${driver.name || 'This driver'} hasn't finished direct-deposit setup with Stripe yet`);
      }
    }
    const cents = rows.reduce((n, r) => n + (r.driver_pay_cents || 0), 0);
    if (cents <= 0) throw new HttpError(409, 'There is nothing to pay on these orders');
    const payout = await insertPayout(client, driver.id, cents, 'stripe', req.user.id);
    let transfer;
    try {
      transfer = await stripe.transferToDriver({
        payoutId: payout.id, accountId: driver.stripe_account_id, cents,
        description: `Choice Delivery driver pay: ${rows.map((r) => r.order_number).join(', ')}`.slice(0, 350),
      });
    } catch (e) {
      if (e.code === 'balance_insufficient') {
        throw new HttpError(409, "Your Stripe balance doesn't have enough available money for this payout yet. "
          + 'Card payments usually become available about 2 business days after they are made.');
      }
      throw new HttpError(502, `Stripe didn't send the payout: ${e.message}`);
    }
    await client.query('UPDATE driver_payouts SET stripe_transfer_id = $2 WHERE id = $1', [payout.id, transfer.id]);
    await settle(client, rows, payout, req.user.id);
    return { rows, cents, transferId: transfer.id };
  });
  res.json({ paidOrders: result.rows.length, totalCents: result.cents, method: 'stripe', transferId: result.transferId });
}));

// Drivers: their own earnings — owed (completed, not yet paid out), this week, and recent payouts.
router.get('/me', asyncH(async (req, res) => {
  if (req.user.role !== 'driver' && !isStaff(req.user)) throw new HttpError(403, 'Drivers only');
  const { rows } = await db.query(
    `SELECT ${ORDER_COLS} FROM orders o LEFT JOIN driver_payouts p ON p.id = o.driver_payout_id
     WHERE o.driver_id = $1 AND o.status = 'completed' AND (o.driver_paid_at IS NULL OR o.driver_paid_at > now() - interval '60 days')
     ORDER BY o.completed_at DESC`, [req.user.id]);
  const orders = rows.map(serialize);
  const unpaid = orders.filter((o) => !o.driverPaidAt);
  const weekStart = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  res.json({
    owedCents: sum(unpaid),
    last7DaysCents: sum(orders.filter((o) => new Date(o.completedAt) > weekStart)),
    paidLast60DaysCents: sum(orders.filter((o) => o.driverPaidAt)),
    orders,
  });
}));

// Drivers: direct-deposit status (re-checked with Stripe while sign-up isn't finished).
router.get('/me/stripe', requireRole('driver'), asyncH(async (req, res) => {
  const { rows: [u] } = await db.query(
    'SELECT id, stripe_account_id, stripe_payouts_enabled, stripe_details_submitted FROM users WHERE id = $1', [req.user.id]);
  let flags;
  if (u.stripe_account_id && !u.stripe_payouts_enabled) flags = await syncStripeAccount(u).catch(() => undefined);
  res.json(stripeStatus(u, flags));
}));

// Drivers: start (or continue) direct-deposit sign-up. Returns Stripe's hosted sign-up page URL.
router.post('/me/stripe/onboard', requireRole('driver'), asyncH(async (req, res) => {
  if (!stripe.enabled()) throw new HttpError(409, "Direct deposit isn't available yet");
  const { rows: [u] } = await db.query('SELECT id, email, stripe_account_id FROM users WHERE id = $1', [req.user.id]);
  let accountId = u.stripe_account_id;
  try {
    if (!accountId) {
      accountId = (await stripe.createDriverAccount({ userId: u.id, email: u.email })).id;
      await db.query('UPDATE users SET stripe_account_id = $2 WHERE id = $1', [u.id, accountId]);
    }
    const link = await stripe.createAccountLink({
      accountId, refreshUrl: `${base()}/public/stripe-return?expired=1`, returnUrl: `${base()}/public/stripe-return`,
    });
    res.json({ url: link.url });
  } catch (e) { throw connectError(e); }
}));

// Drivers: open their Stripe Express dashboard (payout history, bank account, tax forms).
router.post('/me/stripe/dashboard', requireRole('driver'), asyncH(async (req, res) => {
  const { rows: [u] } = await db.query('SELECT stripe_account_id, stripe_details_submitted FROM users WHERE id = $1', [req.user.id]);
  if (!u.stripe_account_id || !u.stripe_details_submitted) throw new HttpError(409, 'Finish direct-deposit setup first');
  res.json({ url: (await stripe.createLoginLink(u.stripe_account_id)).url });
}));

module.exports = router;
