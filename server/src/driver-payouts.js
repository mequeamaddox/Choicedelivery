// Paying drivers through Stripe. Three ways money goes out:
//   - batch:    every Wednesday at 9:00 AM (Columbia time) each driver with direct deposit is paid
//               everything they're owed, free;
//   - instant:  a driver asks to be paid now; INSTANT_FEE (fixed + percent) is kept and the rest is
//               paid out to their bank instantly (typically within 30 minutes);
//   - dispatch: dispatch pays one order or a driver's balance from the app.
// A payout is a Stripe transfer to the driver's Express account (which Stripe then pays to their bank),
// recorded in driver_payouts with the orders it covered. Nothing is marked paid unless Stripe accepts it.
const db = require('./db');
const stripe = require('./stripe');
const { HttpError } = require('./util');
const { sendMail } = require('./mailer');

const TIME_ZONE = 'America/New_York';
const BATCH_WEEKDAY = 'Wed';
const BATCH_HOUR = 9;
const INSTANT_FEE = { fixedCents: 150, percent: 1.5 };
const INSTANT_MIN_NET_CENTS = 100; // Stripe's instant minimum is $0.50; keep a little headroom

const money = (c) => `$${(c / 100).toFixed(2)}`;
const instantFee = (cents) => INSTANT_FEE.fixedCents + Math.round((cents * INSTANT_FEE.percent) / 100);

// Wall-clock parts in Columbia for an instant.
function local(at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(at).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// The next Wednesday 9:00 AM Columbia time at or after `now` (as a Date).
function nextBatchAt(now = new Date()) {
  for (let i = 0; i < 8 * 24; i++) {
    const t = new Date(Math.floor(now.getTime() / 3600000) * 3600000 + i * 3600000);
    const l = local(t);
    if (t >= now && l.weekday === BATCH_WEEKDAY && l.hour === BATCH_HOUR) return t;
  }
  return null;
}

// Completed, unpaid orders for a driver, locked for this transaction.
async function lockOwed(client, driverId, orderIds = null) {
  const { rows } = await client.query(
    `SELECT id, driver_id, driver_pay_cents, order_number FROM orders
     WHERE driver_id = $1 AND status = 'completed' AND driver_paid_at IS NULL AND NOT is_demo AND driver_pay_cents > 0
       AND ($2::uuid[] IS NULL OR id = ANY($2::uuid[]))
     ORDER BY completed_at FOR UPDATE`, [driverId, orderIds]);
  return rows;
}

const loadDriver = async (client, driverId) => (await client.query(
  'SELECT id, name, email, stripe_account_id, stripe_payouts_enabled FROM users WHERE id = $1', [driverId])).rows[0];

async function settle(client, rows, payout, actorId) {
  await client.query(
    'UPDATE orders SET driver_paid_at = now(), driver_paid_by = $2, driver_payout_id = $3 WHERE id = ANY($1::uuid[])',
    [rows.map((r) => r.id), actorId, payout.id]);
  for (const r of rows) {
    await client.query('INSERT INTO order_events (order_id, actor_id, type, data) VALUES ($1, $2, $3, $4)',
      [r.id, actorId, 'driver_paid', JSON.stringify({ cents: r.driver_pay_cents, method: payout.method, kind: payout.kind })]);
  }
}

// Pays `rows` (one driver's owed orders) through Stripe. kind: 'dispatch' | 'batch' | 'instant'.
// For instant, the fee is kept and the rest is paid out to the bank right away. Runs inside `client`'s
// transaction; throws HttpError (and nothing is marked paid) if Stripe refuses.
async function payThroughStripe(client, driver, rows, { kind, actorId }) {
  if (!stripe.enabled()) throw new HttpError(409, 'Stripe is not set up');
  if (!driver.stripe_account_id || !driver.stripe_payouts_enabled) {
    throw new HttpError(409, `${driver.name || 'This driver'} hasn't finished direct-deposit setup yet`);
  }
  const gross = rows.reduce((n, r) => n + (r.driver_pay_cents || 0), 0);
  if (gross <= 0) throw new HttpError(409, 'There is nothing to pay on these orders');
  const fee = kind === 'instant' ? instantFee(gross) : 0;
  const net = gross - fee;
  if (kind === 'instant' && net < INSTANT_MIN_NET_CENTS) {
    throw new HttpError(409, `You need more than ${money(INSTANT_MIN_NET_CENTS + instantFee(INSTANT_MIN_NET_CENTS))} owed to get paid instantly; it will go out in the Wednesday payout.`);
  }
  const { rows: [payout] } = await client.query(
    `INSERT INTO driver_payouts (driver_id, cents, method, kind, fee_cents, created_by)
     VALUES ($1, $2, 'stripe', $3, $4, $5) RETURNING id, method, kind`, [driver.id, net, kind, fee, actorId]);
  let transfer;
  try {
    transfer = await stripe.transferToDriver({
      payoutId: payout.id, accountId: driver.stripe_account_id, cents: net,
      description: `Choice Delivery driver pay: ${rows.map((r) => r.order_number).join(', ')}`.slice(0, 350),
    });
  } catch (e) {
    if (e.code === 'balance_insufficient') {
      throw new HttpError(409, kind === 'instant'
        ? "Instant pay isn't available right now. Your pay will go out in the Wednesday payout."
        : "Your Stripe balance doesn't have enough available money for this payout yet. Card payments usually become available about 2 business days after they're made.");
    }
    throw new HttpError(502, `Stripe didn't send the payout: ${e.message}`);
  }
  let stripePayoutId = null;
  let instantFailed = false;
  if (kind === 'instant') {
    try {
      stripePayoutId = (await stripe.instantPayout({ accountId: driver.stripe_account_id, cents: net, payoutId: payout.id })).id;
    } catch (e) {
      // Their bank can't take instant payouts: the money is already in their Stripe balance and goes out
      // on the standard schedule (1–2 business days), so the instant fee isn't charged.
      console.error('Instant payout failed, falling back to standard:', e.message);
      instantFailed = true;
      if (fee > 0) {
        await stripe.transferToDriver({ payoutId: `${payout.id}-fee-refund`, accountId: driver.stripe_account_id, cents: fee,
          description: 'Instant payout fee returned (standard deposit instead)' });
      }
      await client.query("UPDATE driver_payouts SET kind = 'dispatch', fee_cents = 0, cents = $2 WHERE id = $1", [payout.id, gross]);
      payout.kind = 'dispatch';
    }
  }
  await client.query('UPDATE driver_payouts SET stripe_transfer_id = $2, stripe_payout_id = $3 WHERE id = $1',
    [payout.id, transfer.id, stripePayoutId]);
  await settle(client, rows, payout, actorId);
  return {
    payoutId: payout.id, paidOrders: rows.length, grossCents: gross,
    feeCents: instantFailed ? 0 : fee, netCents: instantFailed ? gross : net, instant: kind === 'instant' && !instantFailed,
    instantFailed, transferId: transfer.id,
  };
}

// Marks orders paid outside the app (Cash App, Zelle, check).
async function payByHand(client, driverId, rows, actorId) {
  const cents = rows.reduce((n, r) => n + (r.driver_pay_cents || 0), 0);
  const { rows: [payout] } = await client.query(
    `INSERT INTO driver_payouts (driver_id, cents, method, kind, created_by) VALUES ($1, $2, 'manual', 'dispatch', $3)
     RETURNING id, method, kind`, [driverId, cents, actorId]);
  await settle(client, rows, payout, actorId);
  return { payoutId: payout.id, paidOrders: rows.length, grossCents: cents, netCents: cents, feeCents: 0 };
}

// The Wednesday batch: pays every driver with direct deposit everything they're owed. Runs once per
// Wednesday (claimed through the settings table, so restarts or extra servers don't pay twice).
// Emails the owner a summary. Returns { ran, paid: [...], failed: [...] }.
async function runWeeklyBatch(now = new Date(), { force = false } = {}) {
  const l = local(now);
  if (!force && !(l.weekday === BATCH_WEEKDAY && l.hour >= BATCH_HOUR)) return { ran: false };
  if (!stripe.enabled()) return { ran: false };
  const { rowCount } = await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('driver_payout_batch', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     WHERE settings.value->>'date' IS DISTINCT FROM EXCLUDED.value->>'date'`, [JSON.stringify({ date: l.date })]);
  if (!rowCount) return { ran: false, alreadyRan: true };
  const { rows: drivers } = await db.query(
    `SELECT DISTINCT u.id FROM orders o JOIN users u ON u.id = o.driver_id
     WHERE o.status = 'completed' AND o.driver_paid_at IS NULL AND NOT o.is_demo AND o.driver_pay_cents > 0
       AND u.stripe_account_id IS NOT NULL AND u.stripe_payouts_enabled`);
  const paid = [];
  const failed = [];
  for (const { id } of drivers) {
    try {
      const r = await db.withTx(async (client) => {
        const driver = await loadDriver(client, id);
        const rows = await lockOwed(client, id);
        if (!rows.length) return null;
        return { driver, ...(await payThroughStripe(client, driver, rows, { kind: 'batch', actorId: null })) };
      });
      if (r) paid.push(r);
    } catch (e) {
      const { rows: [u] } = await db.query('SELECT name, email FROM users WHERE id = $1', [id]);
      failed.push({ driver: u, error: e.message });
    }
  }
  const { rows: [{ n: noDeposit }] } = await db.query(
    `SELECT count(DISTINCT o.driver_id)::int AS n FROM orders o JOIN users u ON u.id = o.driver_id
     WHERE o.status = 'completed' AND o.driver_paid_at IS NULL AND NOT o.is_demo AND NOT u.stripe_payouts_enabled`);
  if (paid.length || failed.length || noDeposit) {
    const to = process.env.ORDER_ALERTS_EMAIL || process.env.LEADS_EMAIL || 'info@choicedeliverysc.com';
    const total = paid.reduce((n, p) => n + p.netCents, 0);
    sendMail({
      to,
      subject: `Wednesday driver payouts: ${money(total)} to ${paid.length} driver${paid.length === 1 ? '' : 's'}${failed.length ? ` (${failed.length} failed)` : ''}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
        <p><strong>Paid through Stripe:</strong></p>
        <ul>${paid.map((p) => `<li>${p.driver.name || p.driver.email}: ${money(p.netCents)} (${p.paidOrders} order${p.paidOrders === 1 ? '' : 's'})</li>`).join('') || '<li>Nobody this week</li>'}</ul>
        ${failed.length ? `<p><strong>Couldn't pay:</strong></p><ul>${failed.map((f) => `<li>${f.driver?.name || f.driver?.email}: ${f.error}</li>`).join('')}</ul>` : ''}
        ${noDeposit ? `<p>${noDeposit} driver${noDeposit === 1 ? " hasn't" : "s haven't"} set up direct deposit; pay them by hand on the Driver pay page.</p>` : ''}
        <p><a href="${process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com'}/#/payouts">Open Driver pay</a></p></div>`,
    }).catch((e) => console.error('Payout summary email failed:', e.message));
  }
  return { ran: true, paid, failed };
}

// Checks every minute whether it's time for the Wednesday batch.
function startWeeklyBatchTimer() {
  const tick = () => runWeeklyBatch().catch((e) => console.error('Weekly driver payouts failed:', e));
  setTimeout(tick, 30 * 1000).unref?.();
  setInterval(tick, 60 * 1000).unref?.();
}

module.exports = {
  INSTANT_FEE, INSTANT_MIN_NET_CENTS, instantFee, nextBatchAt, lockOwed, loadDriver, payThroughStripe, payByHand,
  runWeeklyBatch, startWeeklyBatchTimer,
};
