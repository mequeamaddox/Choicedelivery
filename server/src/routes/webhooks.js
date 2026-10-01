// Stripe calls this when a Checkout payment completes. The body must be the raw bytes for
// signature verification, so this router is mounted before express.json().
const express = require('express');
const db = require('../db');
const stripe = require('../stripe');
const { recordEvent, getOrderFor } = require('../orders');
const { notifyDriversOfOrder } = require('../push');
const { alertStaffOfBooking } = require('../notify');

const router = express.Router();
const SYSTEM = { id: null, role: 'dispatcher' };

router.post('/stripe', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  let event;
  try {
    event = stripe.verifyWebhook(req.body, req.get('stripe-signature'));
  } catch (e) {
    return res.status(e.status || 400).json({ message: e.message });
  }
  try {
    const session = event.data?.object || {};
    const paidEvent = (event.type === 'checkout.session.completed' && session.payment_status === 'paid')
      || event.type === 'checkout.session.async_payment_succeeded';
    if (paidEvent) {
      const orderId = session.metadata?.order_id || session.client_reference_id;
      if (session.metadata?.kind === 'charges') {
        // Payment for additional charges (wait time, etc.) on an order that was already paid.
        await db.withTx(async (client) => {
          const { rows } = await client.query(
            `UPDATE order_charges SET status = 'paid', paid_at = now()
             WHERE order_id = $1 AND stripe_session_id = $2 AND status = 'due' RETURNING cents`, [orderId, session.id]);
          if (rows.length) {
            await recordEvent(client, orderId, null, 'charges_paid', { cents: rows.reduce((t, r) => t + r.cents, 0), method: 'card' });
            await client.query('UPDATE orders SET updated_at = now() WHERE id = $1', [orderId]);
          }
        });
        return res.json({ received: true });
      }
      const updated = await db.withTx(async (client) => {
        // Only the order's current payment link counts, and only once (Stripe may retry).
        const { rows } = await client.query(
          `UPDATE orders SET payment_status = 'paid', paid_cents = $3, paid_at = now(), payment_method = 'card',
             stripe_payment_intent = $4, updated_at = now()
           WHERE id = $1 AND stripe_session_id = $2 AND payment_status = 'unpaid' RETURNING id, status`,
          [orderId, session.id, session.amount_total, session.payment_intent]);
        if (rows[0]) await recordEvent(client, orderId, null, 'paid', { cents: session.amount_total, method: 'card' });
        return rows[0];
      });
      if (updated?.status === 'pending') {
        const order = await getOrderFor(SYSTEM, orderId);
        notifyDriversOfOrder(order).catch((e) => console.error('Push notify failed:', e));
        alertStaffOfBooking(orderId);
      }
    }
    res.json({ received: true });
  } catch (e) {
    console.error('Stripe webhook failed:', e);
    res.status(500).json({ message: 'Webhook handling failed' }); // Stripe will retry
  }
});

module.exports = router;
