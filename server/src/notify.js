// Order status emails to the shipper who booked the order: booked, driver assigned, picked up,
// delivered and cancelled. Each includes the live tracking link. Skipped for demo orders, orders
// booked by dispatch, and shippers who turned email updates off. Never blocks the request.
const db = require('./db');
const { CHARGE_KINDS, getFees } = require('./pricing');
const { sendMail } = require('./mailer');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => (c == null ? '' : `$${(c / 100).toFixed(2)}`);

const MESSAGES = {
  quote_saved: (o) => ({
    subject: `Your quote ${o.order_number}: ${money(o.price_cents)}`,
    line: `Your delivery quote of ${money(o.price_cents)} is saved. Book it any time from Orders → Quotes; the price is
      rechecked when you book, since time of day, demand and weather can change it.`,
    quote: true,
  }),
  review_requested: (o) => ({
    subject: `We're pricing your delivery ${o.order_number}`,
    line: `Thanks! This shipment needs a custom price (${esc((o.price_breakdown?.reviewReasons || []).join('; ').toLowerCase())}).
      We'll review it and email you the price, usually within a business hour. Nothing is booked or charged until you accept it.`,
    quote: true,
    button: 'View request',
  }),
  price_ready: (o) => ({
    subject: `Your price is ready: ${o.order_number} ${money(o.price_cents)}`,
    line: `We reviewed your delivery request. The price is <strong>${money(o.price_cents)}</strong>.
      Open it to book${o.payment_status === 'unpaid' ? ' and pay' : ''}.`,
    quote: true,
    button: 'View & book',
  }),
  booked: (o, extra, fees) => ({
    subject: `Order ${o.order_number} booked`,
    note: `Good to know: the first ${fees.waitFreeMinutes} minutes at each stop are free; after that, wait time is
      ${money(fees.waitBlockCents)} per ${fees.waitBlockMinutes} minutes. Shipments heavier than declared, return trips and
      failed attempts may also be charged; we'll email you the reason with any additional charge.`,
    line: o.payment_status === 'unpaid'
      ? `We've got your order. Drivers are notified as soon as payment of ${money(o.price_cents)} goes through.`
      : `We've got your order${o.price_cents != null ? ` (${money(o.price_cents)})` : ''}. We'll email you when a driver is on the way.`,
  }),
  driver_assigned: (o) => ({
    subject: `A driver is on the way: ${o.order_number}`,
    line: `${esc(o.driver_name || 'Your driver')} accepted your order and is heading to the pickup.`,
  }),
  picked_up: (o) => ({
    subject: `Picked up: ${o.order_number}`,
    line: `${esc(o.driver_name || 'Your driver')} picked up your shipment and is on the way to the drop-off.`,
  }),
  delivered: (o, extra) => ({
    subject: `Delivered: ${o.order_number}`,
    line: `Your shipment was delivered${extra?.printedName ? ` and signed for by ${esc(extra.printedName)}` : ''}. Proof of delivery is on the order page.`,
  }),
  charge_added: (o, { charge }) => ({
    subject: `Additional charge on ${o.order_number}: ${money(charge.cents)}`,
    line: `An additional charge of <strong>${money(charge.cents)}</strong> was added to this order for
      <strong>${esc(CHARGE_KINDS[charge.kind] || charge.kind)}</strong>${charge.minutes != null ? ` (${charge.minutes} minutes)` : ''}${charge.description ? `: ${esc(charge.description)}` : ''}.
      ${charge.status === 'due' ? 'You can pay it on the order page.' : 'It will be added to your account bill.'}
      Questions? Call (803) 949-7034.`,
    button: charge.status === 'due' ? 'Pay now' : 'View order',
  }),
  cancelled: (o) => ({
    subject: `Order ${o.order_number} cancelled`,
    line: `This order was cancelled${o.refunded_cents ? ` and ${money(o.refunded_cents)} was refunded to your card` : ''}. Questions? Call (803) 949-7034.`,
  }),
};

async function emailShipper(orderId, kind, extra = {}) {
  try {
    const { rows: [o] } = await db.query(
      `SELECT o.*, u.email, u.name AS shipper_name, u.role AS creator_role, u.email_updates, d.name AS driver_name,
              (SELECT address FROM stops WHERE order_id = o.id ORDER BY sequence LIMIT 1) AS first_address,
              (SELECT address FROM stops WHERE order_id = o.id ORDER BY sequence DESC LIMIT 1) AS last_address
       FROM orders o
       JOIN users u ON u.id = o.created_by
       LEFT JOIN users d ON d.id = o.driver_id
       WHERE o.id = $1`, [orderId]);
    if (!o || o.is_demo || o.creator_role !== 'shipper' || !o.email_updates || !MESSAGES[kind]) return;
    const { subject, line, quote, note, button } = MESSAGES[kind](o, extra, await getFees(db));
    const base = process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
    const track = `${base}/#/track/${o.public_token}`;
    const page = `${base}/#/orders/${o.id}`;
    await sendMail({
      to: o.email,
      subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
  <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><strong>Choice Delivery SC</strong></div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 10px 10px">
    <p>Hi ${esc((o.shipper_name || '').split(' ')[0] || 'there')},</p>
    <p>${line}</p>
    <p style="color:#4b5563"><strong>${esc(o.order_number)}</strong><br>${esc(o.first_address)} &rarr; ${esc(o.last_address)}</p>
    ${quote
    ? `<p><a href="${page}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${button || 'View &amp; book quote'}</a></p>`
    : button
    ? `<p><a href="${page}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${button}</a></p>`
    : `<p><a href="${track}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Track delivery</a>
       &nbsp; <a href="${page}" style="color:#0f766e">View order</a></p>
    <p style="color:#6b7280;font-size:12px">You can share the tracking link with whoever is receiving the delivery.</p>`}
    ${note ? `<p style="color:#4b5563;font-size:13px">${note}</p>` : ''}
    <p style="color:#6b7280;font-size:12px">To stop these emails, turn off "Email updates" on your Account page.</p>
  </div></div>`,
    });
  } catch (e) {
    console.error(`Order email (${kind}) failed:`, e.message);
  }
}

// Where staff alerts go: ORDER_ALERTS_EMAIL, else LEADS_EMAIL, else info@.
const staffInbox = () => process.env.ORDER_ALERTS_EMAIL || process.env.LEADS_EMAIL || 'info@choicedeliverysc.com';

// Emails the owner/dispatch when a customer's order is booked and ready for drivers (account
// customers right away, card customers once payment goes through). Not for demo orders or orders
// dispatch booked themselves. Never blocks the request.
async function alertStaffOfBooking(orderId) {
  try {
    const { rows: [o] } = await db.query(
      `SELECT o.*, u.name AS shipper_name, u.email AS shipper_email, u.role AS creator_role, org.name AS company,
              (SELECT count(*) FROM stops WHERE order_id = o.id)::int AS stop_count,
              (SELECT address FROM stops WHERE order_id = o.id ORDER BY sequence LIMIT 1) AS first_address,
              (SELECT address FROM stops WHERE order_id = o.id ORDER BY sequence DESC LIMIT 1) AS last_address
       FROM orders o JOIN users u ON u.id = o.created_by LEFT JOIN organizations org ON org.id = o.organization_id
       WHERE o.id = $1`, [orderId]);
    if (!o || o.is_demo || o.creator_role !== 'shipper') return;
    const base = process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
    const when = o.scheduled_at
      ? new Date(o.scheduled_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'As soon as possible';
    const paid = o.payment_status === 'paid' ? `paid by card` : o.payment_status === 'invoice' ? 'billed to account' : esc(o.payment_status);
    const rows = [
      ['Customer', `${esc(o.company || o.shipper_name)}${o.company && o.shipper_name ? ` (${esc(o.shipper_name)})` : ''} · ${esc(o.shipper_email)}`],
      ['Route', `${esc(o.first_address)} &rarr; ${esc(o.last_address)}${o.stop_count > 2 ? ` (${o.stop_count} stops)` : ''}`],
      ['Pickup', esc(when)],
      ['Service', `${o.service_level === 'rush' ? '<strong>RUSH</strong>' : 'Standard'} · ${esc(o.vehicle_type || '')}${o.distance_miles != null ? ` · about ${Number(o.distance_miles)} mi` : ''}`],
      ['Price', `${money(o.price_cents)} (${paid})${o.driver_pay_cents != null ? ` · driver pay ${money(o.driver_pay_cents)}` : ''}`],
    ];
    await sendMail({
      to: staffInbox(),
      subject: `New ${o.service_level === 'rush' ? 'RUSH ' : ''}order ${o.order_number}: ${money(o.price_cents)}${o.company ? ` · ${o.company}` : ''}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
  <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><strong>Choice Delivery SC</strong> · New order</div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 10px 10px">
    <p><strong>${esc(o.order_number)}</strong> was just booked. Drivers have been notified.</p>
    <table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top">${k}</td><td style="padding:4px 0">${v}</td></tr>`).join('')}</table>
    <p><a href="${base}/#/orders/${o.id}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Open the order</a></p>
  </div></div>`,
    });
  } catch (e) {
    console.error('New order alert failed:', e.message);
  }
}

module.exports = { emailShipper, alertStaffOfBooking };
