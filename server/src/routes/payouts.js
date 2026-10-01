// Driver pay: what each driver has earned on completed orders, and paying it. Drivers who've set up
// direct deposit (a Stripe Express account) are paid with a Stripe transfer to their bank; anyone can
// also be marked paid by hand (Cash App, Zelle, check). Every payout is recorded with its orders.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, isStaff, signScopedToken } = require('../auth');
const { asyncH, HttpError } = require('../util');
const stripe = require('../stripe');
const {
  INSTANT_FEE, INSTANT_MIN_NET_CENTS, instantFee, nextBatchAt, lockOwed, loadDriver, payThroughStripe, payByHand,
} = require('../driver-payouts');

const router = express.Router();
// The payout-method page can also be opened from the driver app with a short-lived link.
const PAYOUT_METHOD_PATHS = ['/me/payout-method', '/me/account-session'];
router.use((req, res, next) => { if (PAYOUT_METHOD_PATHS.includes(req.path)) req.authScope = 'payout_method'; next(); });
router.use(requireAuth);

const ORDER_COLS = `o.id, o.order_number, o.completed_at, o.driver_pay_cents, o.driver_paid_at, o.driver_id,
  p.method AS payout_method, p.kind AS payout_kind,
  (SELECT address FROM stops s WHERE s.order_id = o.id ORDER BY sequence LIMIT 1) AS pickup,
  (SELECT address FROM stops s WHERE s.order_id = o.id ORDER BY sequence DESC LIMIT 1) AS dropoff`;
const serialize = (r) => ({
  id: r.id, orderNumber: r.order_number, completedAt: r.completed_at, driverPayCents: r.driver_pay_cents ?? 0,
  driverPaidAt: r.driver_paid_at, payoutMethod: r.payout_method || null, payoutKind: r.payout_kind || null, pickup: r.pickup, dropoff: r.dropoff,
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
  // Stripe's exact reason goes to the server log (Railway) so the setup step it wants can be found.
  console.error('Stripe Connect onboarding failed:', e.message);
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

// Staff: mark orders' driver pay as paid outside the app (one payout record per driver). Body: { orderIds }.
router.post('/mark-paid', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const result = await db.withTx(async (client) => {
    const rows = await lockUnpaid(client, req.body?.orderIds);
    const byDriver = new Map();
    for (const r of rows) byDriver.set(r.driver_id, [...(byDriver.get(r.driver_id) || []), r]);
    for (const [driverId, list] of byDriver) await payByHand(client, driverId, list, req.user.id);
    return rows;
  });
  res.json({ paidOrders: result.length, totalCents: result.reduce((n, r) => n + (r.driver_pay_cents || 0), 0) });
}));

// Staff: pay a driver's orders through Stripe now (a transfer to their direct-deposit account), e.g.
// the Pay driver button on an order. Body: { orderIds }, all for one driver. No fee.
router.post('/pay-stripe', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  if (!stripe.enabled()) throw new HttpError(409, 'Stripe is not set up');
  const result = await db.withTx(async (client) => {
    const rows = await lockUnpaid(client, req.body?.orderIds);
    if (!rows.length) throw new HttpError(409, 'These orders were already paid');
    const driverIds = [...new Set(rows.map((r) => r.driver_id))];
    if (driverIds.length > 1) throw new HttpError(400, 'Pay one driver at a time');
    const driver = await loadDriver(client, driverIds[0]);
    if (driver.stripe_account_id && !driver.stripe_payouts_enabled) {
      driver.stripe_payouts_enabled = (await syncStripeAccount(driver).catch(() => ({}))).payoutsEnabled;
    }
    return payThroughStripe(client, driver, rows, { kind: 'dispatch', actorId: req.user.id });
  });
  res.json({ paidOrders: result.paidOrders, totalCents: result.netCents, method: 'stripe', transferId: result.transferId });
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
  const owed = sum(unpaid);
  const fee = instantFee(owed);
  res.json({
    owedCents: owed,
    last7DaysCents: sum(orders.filter((o) => new Date(o.completedAt) > weekStart)),
    paidLast60DaysCents: sum(orders.filter((o) => o.driverPaidAt)),
    // Free weekly payout, or get paid now for a fee.
    nextPayoutAt: nextBatchAt(),
    instant: {
      feeFixedCents: INSTANT_FEE.fixedCents, feePercent: INSTANT_FEE.percent,
      feeCents: owed ? fee : 0, netCents: Math.max(0, owed - fee),
      available: owed - fee >= INSTANT_MIN_NET_CENTS,
    },
    orders,
  });
}));

// Drivers: get paid now. Keeps the instant fee and pays the rest out to their bank right away
// (typically within 30 minutes). If their bank can't take instant payouts, the full amount goes by
// standard deposit (1–2 business days) with no fee.
router.post('/me/instant', requireRole('driver'), asyncH(async (req, res) => {
  const expected = req.body?.expectedNetCents;
  const result = await db.withTx(async (client) => {
    const driver = await loadDriver(client, req.user.id);
    if (driver.stripe_account_id && !driver.stripe_payouts_enabled) {
      driver.stripe_payouts_enabled = (await syncStripeAccount(driver).catch(() => ({}))).payoutsEnabled;
    }
    const rows = await lockOwed(client, req.user.id);
    if (!rows.length) throw new HttpError(409, "You don't have any unpaid deliveries right now");
    const owed = rows.reduce((n, r) => n + (r.driver_pay_cents || 0), 0);
    if (expected != null && Number(expected) !== owed - instantFee(owed)) {
      throw new HttpError(409, 'Your balance just changed. Refresh and try again.');
    }
    return payThroughStripe(client, driver, rows, { kind: 'instant', actorId: req.user.id });
  });
  res.json(result);
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
  const { rows: [u] } = await db.query('SELECT id, email, name, phone_number, stripe_account_id FROM users WHERE id = $1', [req.user.id]);
  let accountId = u.stripe_account_id;
  try {
    if (!accountId) {
      const [firstName, ...rest] = String(u.name || '').trim().split(/\s+/);
      const digits = String(u.phone_number || '').replace(/\D/g, '');
      const phone = digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : undefined;
      accountId = (await stripe.createDriverAccount({
        userId: u.id, email: u.email, firstName: firstName || undefined, lastName: rest.join(' ') || undefined, phone,
      })).id;
      await db.query('UPDATE users SET stripe_account_id = $2 WHERE id = $1', [u.id, accountId]);
    }
    const link = await stripe.createAccountLink({
      accountId, refreshUrl: `${base()}/public/stripe-return?expired=1`, returnUrl: `${base()}/public/stripe-return`,
    });
    res.json({ url: link.url });
  } catch (e) { throw connectError(e); }
}));

// Where a driver's pay goes: { method: { type: 'card'|'bank', label, instant } | null }.
const describeDestination = (x) => (!x ? null : {
  type: x.object === 'card' ? 'card' : 'bank',
  label: x.object === 'card' ? `${x.brand || 'Card'} ${x.funding === 'debit' ? 'debit ' : ''}•••• ${x.last4}` : `${x.bank_name || 'Bank account'} •••• ${x.last4}`,
  instant: (x.available_payout_methods || []).includes('instant'),
});
async function payoutDestinations(accountId) {
  const acct = await stripe.getAccount(accountId);
  const list = acct.external_accounts?.data || [];
  return {
    method: describeDestination(list.find((x) => x.default_for_currency) || list[0]),
    instantMethod: describeDestination(list.find((x) => (x.available_payout_methods || []).includes('instant'))),
  };
}

router.get('/me/payout-method', requireRole('driver'), asyncH(async (req, res) => {
  const { rows: [u] } = await db.query('SELECT stripe_account_id FROM users WHERE id = $1', [req.user.id]);
  if (!u.stripe_account_id || !stripe.enabled()) return res.json({ method: null, instantMethod: null });
  res.json(await payoutDestinations(u.stripe_account_id));
}));

// Drivers: a session for Stripe's embedded form to add or change the bank account / debit card.
router.post('/me/account-session', requireRole('driver'), asyncH(async (req, res) => {
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new HttpError(409, "Changing your bank or card here isn't switched on yet. Ask Choice Delivery to add their Stripe publishable key.");
  const { rows: [u] } = await db.query('SELECT stripe_account_id FROM users WHERE id = $1', [req.user.id]);
  if (!u.stripe_account_id) throw new HttpError(409, 'Set up direct deposit first');
  const session = await stripe.createAccountSession(u.stripe_account_id);
  res.json({ clientSecret: session.client_secret, publishableKey });
}));

// Drivers (phone app): a 15-minute link that opens the bank & debit card page in the browser,
// already signed in for that page only.
router.post('/me/payout-link', requireRole('driver'), asyncH(async (req, res) => {
  const t = signScopedToken(req.user.id, 'payout_method');
  res.json({ url: `${base()}/#/driver/payout-method?t=${encodeURIComponent(t)}` });
}));

module.exports = router;
