// Card holds: instead of charging card orders at booking, we hold the price plus a buffer for possible
// extra charges, and charge the card after delivery (price + any extra charges that fit in the buffer).
// Unused hold is released. Cancelling releases the hold (free for us, unlike a refund), or keeps the TONU
// fee once a driver is on the way. A hold lasts about 7 days, so orders scheduled further out than
// HOLD_MAX_DAYS_AHEAD are charged at booking as before.
const db = require('./db');
const stripe = require('./stripe');

const HOLD_MAX_DAYS_AHEAD = 5;
const CHARGE_AFTER_DELIVERY_MINUTES = 120; // time for dispatch to add wait time etc. before the card is charged

// The buffer held on top of the price: a quarter of it, at least $15 and at most $75.
const bufferFor = (priceCents) => Math.min(7500, Math.max(1500, Math.round((priceCents * 0.25) / 100) * 100));

// Checkout amounts for an order: hold when pickup is ASAP or within HOLD_MAX_DAYS_AHEAD days.
function checkoutAmounts({ priceCents, scheduledAt }) {
  const far = scheduledAt && new Date(scheduledAt) - Date.now() > HOLD_MAX_DAYS_AHEAD * 86400e3;
  return { amountCents: priceCents, holdBufferCents: far ? 0 : bufferFor(priceCents) };
}

// Checkout finished on a hold session: record the hold. Returns { id, status, was } like a payment, or null.
async function recordHold(session) {
  const orderId = session.metadata?.order_id || session.client_reference_id;
  const pi = await stripe.getPaymentIntent(session.payment_intent);
  // Already charged (some wallets don't support holds): handled like a normal payment.
  // Shouldn't happen (checkout only offers ways to pay that support holds); if it does, dispatch is told to
  // refund the unused buffer.
  if (pi.status === 'succeeded') {
    require('./webpush').notifyStaff('problems', { title: 'Card charged instead of held',
      body: `Order ${session.metadata?.order_number || ''} was charged the full hold. Refund the extra buffer from the payment dashboard.`, url: `/#/orders/${orderId}` });
    return { charged: true };
  }
  if (pi.status !== 'requires_capture') return null;
  const held = pi.amount_capturable || pi.amount;
  const before = pi.latest_charge?.payment_method_details?.card?.capture_before;
  const expires = before ? new Date(before * 1000) : new Date(Date.now() + 6.5 * 86400e3);
  const { recordEvent } = require('./orders');
  return db.withTx(async (client) => {
    const { rows } = await client.query(
      `WITH prev AS (SELECT payment_status FROM orders WHERE id = $1)
       UPDATE orders SET payment_status = 'authorized', hold_cents = $3, hold_expires_at = $4, payment_method = 'card',
         stripe_payment_intent = $5, updated_at = now()
       WHERE id = $1 AND stripe_session_id = $2 AND payment_status IN ('unpaid', 'invoice')
       RETURNING id, status, (SELECT payment_status FROM prev) AS was`,
      [orderId, session.id, held, expires, pi.id]);
    if (rows[0]) await recordEvent(client, orderId, null, 'card_held', { cents: held });
    return rows[0] || null;
  });
}

// Room left in the hold for extra charges.
async function holdRoom(client, orderId) {
  const { rows: [o] } = await client.query(
    `SELECT o.hold_cents, o.price_cents,
       (SELECT COALESCE(sum(cents), 0) FROM order_charges c WHERE c.order_id = o.id AND c.status = 'hold')::int AS held_extras
     FROM orders o WHERE o.id = $1 AND o.payment_status = 'authorized'`, [orderId]);
  return o ? o.hold_cents - o.price_cents - o.held_extras : 0;
}

// Charges the held card: the price plus extra charges in the hold (or `amountCents`, e.g. the TONU fee).
// Returns the amount charged, or null if the order has no hold.
// Pass `client` to run inside a transaction that already has the order locked.
const inTx = (client, fn) => (client ? fn(client) : db.withTx(fn));

async function charge(orderId, { actorId = null, amountCents = null, reason, client: outer } = {}) {
  const { recordEvent } = require('./orders');
  return inTx(outer, async (client) => {
    const { rows: [o] } = await client.query(
      `SELECT o.id, o.price_cents, o.hold_cents, o.stripe_payment_intent,
         (SELECT COALESCE(sum(cents), 0) FROM order_charges c WHERE c.order_id = o.id AND c.status = 'hold')::int AS extras
       FROM orders o WHERE o.id = $1 AND o.payment_status = 'authorized' FOR UPDATE OF o`, [orderId]);
    if (!o) return null;
    const amount = Math.min(o.hold_cents, amountCents ?? (o.price_cents + o.extras));
    const pi = await stripe.capturePaymentIntent(o.stripe_payment_intent, amount);
    const got = pi.amount_received || amount;
    await client.query(
      `UPDATE orders SET payment_status = 'paid', paid_cents = $2, paid_at = now(), updated_at = now() WHERE id = $1`, [o.id, got]);
    if (amountCents == null) {
      await client.query("UPDATE order_charges SET status = 'paid', paid_at = now() WHERE order_id = $1 AND status = 'hold'", [o.id]);
    } else {
      await client.query("UPDATE order_charges SET status = 'waived' WHERE order_id = $1 AND status = 'hold'", [o.id]);
    }
    await recordEvent(client, o.id, actorId, 'paid', { cents: got, method: 'card', fromHold: true, reason });
    return got;
  });
}

// Lets go of the hold (order cancelled). Returns true if there was one.
async function release(orderId, { actorId = null, client: outer } = {}) {
  const { recordEvent } = require('./orders');
  return inTx(outer, async (client) => {
    const { rows: [o] } = await client.query(
      "SELECT id, stripe_payment_intent FROM orders WHERE id = $1 AND payment_status = 'authorized' FOR UPDATE", [orderId]);
    if (!o) return false;
    await stripe.cancelPaymentIntent(o.stripe_payment_intent);
    await client.query("UPDATE orders SET payment_status = 'released', updated_at = now() WHERE id = $1", [o.id]);
    await client.query("UPDATE order_charges SET status = 'waived' WHERE order_id = $1 AND status = 'hold'", [o.id]);
    await recordEvent(client, o.id, actorId, 'hold_released', {});
    return true;
  });
}

// Every few minutes: charge held cards for deliveries done a while ago (time for dispatch to add extra
// charges), and any hold about to expire.
async function chargeDue() {
  const { rows } = await db.query(
    `SELECT id FROM orders WHERE payment_status = 'authorized' AND status <> 'cancelled'
       AND ((status = 'completed' AND completed_at < now() - make_interval(mins => $1))
         OR hold_expires_at < now() + interval '12 hours')
       -- after a failed attempt, wait a few hours (dispatch is alerted) instead of retrying every run
       AND NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = orders.id AND e.type = 'charge_failed'
                       AND e.created_at > now() - interval '4 hours')`, [CHARGE_AFTER_DELIVERY_MINUTES]);
  let n = 0;
  for (const r of rows) {
    try { if (await charge(r.id, { reason: 'after_delivery' }) != null) n += 1; } catch (e) {
      console.error(`Charging the held card for order ${r.id} failed:`, e.message);
      await db.query("INSERT INTO order_events (order_id, actor_id, type, data) VALUES ($1, NULL, 'charge_failed', $2)",
        [r.id, JSON.stringify({ message: e.message })]).catch(() => {});
      require('./webpush').notifyStaff('problems', { title: 'Card charge failed', body: e.message.slice(0, 150), url: `/#/orders/${r.id}` });
    }
  }
  return n;
}

function startChargeTimer() {
  if (!stripe.enabled()) return;
  setInterval(() => { chargeDue().catch((e) => console.error('Card hold charging failed:', e.message)); }, 10 * 60 * 1000).unref();
}

module.exports = { HOLD_MAX_DAYS_AHEAD, bufferFor, checkoutAmounts, recordHold, holdRoom, charge, release, chargeDue, startChargeTimer };
