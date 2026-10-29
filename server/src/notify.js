// Order status emails to the shipper who booked the order: booked, driver assigned, picked up,
// delivered and cancelled. Each includes the live tracking link. Skipped for demo orders, orders
// booked by dispatch, and shippers who turned email updates off. Never blocks the request.
const db = require('./db');
const { CHARGE_KINDS, getFees } = require('./pricing');
const { sendMail } = require('./mailer');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => (c == null ? '' : `$${(c / 100).toFixed(2)}`);

// Adds a customer email to the order's History (shown to dispatch only), so there's a record of what was sent.
const logOrderEmail = (orderId, type, data) => db.query(
  'INSERT INTO order_events (order_id, actor_id, type, data) VALUES ($1, NULL, $2, $3)', [orderId, type, JSON.stringify(data)])
  .catch((e) => console.error('Order email log failed:', e.message));

const MESSAGES = {
  quote_saved: (o) => ({
    subject: `Your quote ${o.order_number}: ${money(o.price_cents)}`,
    line: `Your delivery quote of ${money(o.price_cents)} is saved. Book it any time from Orders → Quotes; the price is
      rechecked when you book, since time of day, demand and weather can change it.`,
    quote: true,
  }),
  review_requested: (o) => (!o.price_breakdown?.needsReview && o.price_breakdown?.needsApproval ? {
    subject: `We're confirming your delivery ${o.order_number}`,
    line: `Thanks! ${esc(o.price_breakdown.approvalReason)}, so we confirm jobs like this before booking. Your quote is
      <strong>${money(o.price_cents)}</strong>. We'll email you once it's approved, usually within a business hour. Nothing is
      booked or charged until then.`,
    quote: true,
    button: 'View request',
  } : {
    subject: `We're pricing your delivery ${o.order_number}`,
    line: `Thanks! This shipment needs a custom price (${esc((o.price_breakdown?.reviewReasons || []).join('; ').toLowerCase())}).
      We'll review it and email you the price, usually within a business hour. Nothing is booked or charged until you accept it.`,
    quote: true,
    button: 'View request',
  }),
  price_ready: (o) => (o.is_guest ? {
    subject: `Approved: ${o.order_number} ${money(o.price_cents)}`,
    line: `We reviewed your delivery request and it's approved. The price is <strong>${money(o.price_cents)}</strong>.
      Pay below to book it; drivers are notified as soon as payment goes through.`,
  } : {
    subject: `Approved: ${o.order_number} ${money(o.price_cents)}`,
    line: `We reviewed your delivery request and it's approved. The price is <strong>${money(o.price_cents)}</strong>.
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
    line: `Your shipment was delivered${extra?.printedName ? ` and signed for by ${esc(extra.printedName)}` : ''}. ${o.creator_role === 'shipper'
      ? 'Proof of delivery is on the order page.' : "Reply to this email if you'd like a copy of the delivery photo."}`,
  }),
  charge_added: (o, { charge }) => ({
    subject: `Additional charge on ${o.order_number}: ${money(charge.cents)}`,
    line: `An additional charge of <strong>${money(charge.cents)}</strong> was added to this order for
      <strong>${esc(CHARGE_KINDS[charge.kind] || charge.kind)}</strong>${charge.minutes != null ? ` (${charge.minutes} minutes)` : ''}${charge.description ? `: ${esc(charge.description)}` : ''}.
      ${charge.status === 'due' ? 'You can pay it on the order page.' : 'It will be added to your account bill.'}
      Questions? Email info@choicedeliverysc.com.`,
    button: charge.status === 'due' ? 'Pay now' : 'View order',
  }),
  cancelled: (o) => ({
    subject: `Order ${o.order_number} cancelled`,
    line: `This order was cancelled${o.refunded_cents ? ` and ${money(o.refunded_cents)} was refunded to your card` : ''}. Questions? Email info@choicedeliverysc.com.`,
  }),
};

async function emailShipper(orderId, kind, extra = {}) {
  let sent = null;
  try {
    const { rows: [o] } = await db.query(
      `SELECT o.*, u.email, u.name AS shipper_name, u.role AS creator_role, u.email_updates, d.name AS driver_name,
              (SELECT address FROM stops WHERE order_id = o.id ORDER BY sequence LIMIT 1) AS first_address,
              (SELECT address FROM stops WHERE order_id = o.id ORDER BY sequence DESC LIMIT 1) AS last_address
       FROM orders o
       LEFT JOIN users u ON u.id = o.created_by
       LEFT JOIN users d ON d.id = o.driver_id
       WHERE o.id = $1`, [orderId]);
    if (!o || o.is_demo || !MESSAGES[kind]) return;
    if (!o.created_by && !o.is_guest) return;
    // Booked by the customer: their account email (unless they turned updates off). Booked by dispatch
    // for someone without an account: the customer email entered on the order.
    const byCustomer = o.creator_role === 'shipper';
    const to = byCustomer ? (o.email_updates ? o.email : null) : o.customer_email;
    if (!to) return;
    if (!byCustomer) o.shipper_name = o.customer_name || '';
    const { subject, line, quote, note, button } = MESSAGES[kind](o, extra, await getFees(db));
    const base = process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
    const track = `${base}/#/track/${o.public_token}`;
    const page = `${base}/#/orders/${o.id}`;
    if (!byCustomer && (o.payment_requested_at || o.is_guest) && o.payment_status === 'unpaid'
      && ['booked', 'driver_assigned', 'price_ready'].includes(kind)) {
      Object.assign(extra, { payLink: true });
    }
    // A guest's request waiting for review has nothing to track yet.
    const trackable = o.status !== 'quote' && kind !== 'review_requested';
    sent = { orderId: o.id, to, subject, kind, payLink: !!extra.payLink };
    await sendMail({
      to,
      subject,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
  <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><strong>Choice Delivery SC</strong></div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 10px 10px">
    <p>Hi ${esc((o.shipper_name || '').split(' ')[0] || 'there')},</p>
    <p>${line}</p>
    <p style="color:#4b5563"><strong>${esc(o.order_number)}</strong><br>${esc(o.first_address)} &rarr; ${esc(o.last_address)}</p>
    ${!byCustomer
    ? `${trackable ? `<p><a href="${track}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Track delivery</a></p>` : ''}
       ${extra.payLink ? `<p>Amount due: <strong>${money(o.price_cents)}</strong></p>
       <p><a href="${base}/public/pay/${o.public_token}" style="background:#111827;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Pay ${money(o.price_cents)} by card</a></p>` : ''}`
    : quote
    ? `<p><a href="${page}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${button || 'View &amp; book quote'}</a></p>`
    : button
    ? `<p><a href="${page}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${button}</a></p>`
    : `<p><a href="${track}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Track delivery</a>
       &nbsp; <a href="${page}" style="color:#0f766e">View order</a></p>
    <p style="color:#6b7280;font-size:12px">You can share the tracking link with whoever is receiving the delivery.</p>`}
    ${note ? `<p style="color:#4b5563;font-size:13px">${note}</p>` : ''}
    ${byCustomer ? '<p style="color:#6b7280;font-size:12px">To stop these emails, turn off "Email updates" on your Account page.</p>' : ''}
  </div></div>`,
    });
    const { orderId: id, ...data } = sent;
    await logOrderEmail(id, 'email_sent', data);
  } catch (e) {
    console.error(`Order email (${kind}) failed:`, e.message);
    if (sent) {
      const { orderId: id, ...data } = sent;
      await logOrderEmail(id, 'email_failed', { ...data, error: String(e.message).slice(0, 300) });
    }
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
       FROM orders o LEFT JOIN users u ON u.id = o.created_by LEFT JOIN organizations org ON org.id = o.organization_id
       WHERE o.id = $1`, [orderId]);
    if (!o || o.is_demo || (o.creator_role !== 'shipper' && !o.is_guest)) return;
    const base = process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
    const when = o.scheduled_at
      ? new Date(o.scheduled_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'As soon as possible';
    const paid = o.payment_status === 'paid' ? `paid by card` : o.payment_status === 'invoice' ? 'billed to account' : esc(o.payment_status);
    const rows = [
      o.is_guest
        ? ['Customer', `<strong>Guest</strong>: ${esc(o.customer_name)} · ${esc(o.customer_email)}${o.customer_phone ? ` · ${esc(o.customer_phone)}` : ''}`]
        : ['Customer', `${esc(o.company || o.shipper_name)}${o.company && o.shipper_name ? ` (${esc(o.shipper_name)})` : ''} · ${esc(o.shipper_email)}`],
      ['Route', `${esc(o.first_address)} &rarr; ${esc(o.last_address)}${o.stop_count > 2 ? ` (${o.stop_count} stops)` : ''}`],
      ['Pickup', esc(when)],
      ['Service', `${o.service_level === 'rush' ? '<strong>RUSH</strong>' : 'Standard'} · ${esc(o.vehicle_type || '')}${o.distance_miles != null ? ` · about ${Number(o.distance_miles)} mi` : ''}`],
      ['Price', `${money(o.price_cents)} (${paid})${o.driver_pay_cents != null ? ` · driver pay ${money(o.driver_pay_cents)}` : ''}`],
    ];
    await sendMail({
      to: staffInbox(),
      subject: `New ${o.service_level === 'rush' ? 'RUSH ' : ''}${o.is_guest ? 'guest ' : ''}order ${o.order_number}: ${money(o.price_cents)}${o.company ? ` · ${o.company}` : o.is_guest ? ` · ${o.customer_name}` : ''}`,
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

// Emails the owner/dispatch when a customer signs up on their own, with where they came from.
// Never blocks the signup.
const CHANNEL_LABELS = { facebook: 'Facebook / Instagram', google_ads: 'Google Ads', bing_ads: 'Bing Ads', direct: 'Direct (typed the address or no source)' };
async function alertStaffOfSignup({ user, company, phone, attribution, medical = false }) {
  try {
    const base = process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
    const source = attribution?.channel ? (CHANNEL_LABELS[attribution.channel] || attribution.channel) : CHANNEL_LABELS.direct;
    const forSelf = !company || company === user.name;
    const rows = [
      ['Name', esc(user.name || '—')],
      [forSelf ? 'Account' : 'Company', forSelf ? 'Shipping for themselves' : esc(company)],
      ...(medical ? [['Type', '<strong>Medical facility</strong> (chain of custody on every order)']] : []),
      ['Email', `<a href="mailto:${esc(user.email)}">${esc(user.email)}</a>`],
      ['Phone', phone ? esc(phone) : '—'],
      ['Came from', `${esc(source)}${attribution?.utm_campaign ? ` · campaign "${esc(attribution.utm_campaign)}"` : ''}${attribution?.landingPage ? ` · landed on ${esc(attribution.landingPage)}` : ''}`],
    ];
    await sendMail({
      to: staffInbox(),
      subject: `New ${medical ? 'medical facility' : 'customer'} signup: ${forSelf ? (user.name || user.email) : company}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
  <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><strong>Choice Delivery SC</strong> · New customer</div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 10px 10px">
    <p>Someone just created a customer account.</p>
    <table style="border-collapse:collapse;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;vertical-align:top">${k}</td><td style="padding:4px 0">${v}</td></tr>`).join('')}</table>
    <p style="color:#4b5563;font-size:13px">A quick welcome email from you can turn a signup into a first booking.</p>
    <p><a href="${base}/#/companies" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Open Companies</a></p>
  </div></div>`,
    });
  } catch (e) {
    console.error('New signup alert failed:', e.message);
  }
}

// Welcome email to a customer who just signed up on their own: how to book, and (for businesses) the
// account features. Replies go to the support inbox. Never blocks the signup.
async function welcomeShipper({ user, company }) {
  try {
    const base = process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
    const support = process.env.SUPPORT_EMAIL || 'info@choicedeliverysc.com';
    const first = esc((user.name || '').split(' ')[0] || 'there');
    const business = company && company !== user.name;
    const p = (t) => `<p>${t}</p>`;
    const li = (t) => `<li style="margin-bottom:6px">${t}</li>`;
    const body = business ? [
      p(`Thanks for signing up with Choice Delivery SC! We're a locally owned courier right here in Columbia, and we're glad to have ${esc(company)} on board.`),
      p('<strong>Booking your first delivery takes about 2 minutes:</strong>'),
      `<ol style="padding-left:20px">${[
        'Log in and tap <strong>New order</strong>.',
        "Enter the pickup and drop-off addresses. You'll see your exact price right away.",
        'Choose <strong>Standard</strong> (same day) or <strong>Rush</strong> (first in line and driven straight there, about 2 hours around Columbia), pick a car, minivan or pickup truck, and pay securely.',
      ].map(li).join('')}</ol>`,
      p("Once it's booked, you'll get a tracking link to follow your driver on the map, plus a photo and signature when it's delivered."),
      p('<strong>A few things that make it easier:</strong>'),
      `<ul style="padding-left:20px">${[
        'Save quotes and book them later.',
        'Add coworkers to your account so your whole team can book.',
        `Print a free shipping label with a barcode from the <a href="${base}/#/shipping-form" style="color:#0f766e">shipping form</a>. No label printer needed.`,
        'Sending deliveries often? Reply to this email and ask about a business account with monthly invoicing.',
      ].map(li).join('')}</ul>`,
      p('Questions, or a delivery that needs special handling? Just reply to this email and we\'ll get back to you.'),
    ] : [
      p("Thanks for signing up with Choice Delivery SC! We're a locally owned courier right here in Columbia."),
      p("Whenever you need something picked up and delivered today, log in, tap <strong>New order</strong> and enter both addresses. You'll see your price right away, can track your driver live on the map, and get a photo when it's delivered."),
      p('Picking up something you bought on Facebook Marketplace? Pay the seller first, put their address as the pickup with their name and phone number, and have someone there to help load.'),
      p('Questions? Just reply to this email.'),
    ];
    await sendMail({
      to: user.email,
      replyTo: support,
      subject: `Welcome to Choice Delivery, ${(user.name || '').split(' ')[0] || 'and thanks for signing up'}!`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827;line-height:1.5">
  <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><strong>Choice Delivery SC</strong></div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 10px 10px">
    <p>Hi ${first},</p>
    ${body.join('\n    ')}
    <p><a href="${base}/#/orders/new" style="background:#0f766e;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">Book a delivery</a></p>
    <p>We look forward to delivering for you!<br>The Choice Delivery team<br>
      <a href="https://choicedeliverysc.com" style="color:#0f766e">choicedeliverysc.com</a></p>
  </div></div>`,
    });
  } catch (e) {
    console.error('Welcome email failed:', e.message);
  }
}

// Invitation to someone added to a customer company (by dispatch setting the company up, or by a
// coworker on their Team page): choose a password (the link works for 7 days), then book.
async function inviteCustomer({ user, company, token, invitedBy, billing }) {
  const base = process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
  const support = process.env.SUPPORT_EMAIL || 'info@choicedeliverysc.com';
  const first = esc((user.name || '').split(' ')[0] || 'there');
  const who = invitedBy ? `${esc(invitedBy)} added you` : 'Choice Delivery SC set up an account for you';
  await sendMail({
    to: user.email,
    replyTo: support,
    subject: `Your Choice Delivery account for ${company}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827;line-height:1.5">
  <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><strong>Choice Delivery SC</strong></div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 10px 10px">
    <p>Hi ${first},</p>
    <p>${who} to book and track same-day deliveries for <strong>${esc(company)}</strong>. Choose your password to get started
      (this link works for 7 days). Your login is this email address, ${esc(user.email)}.</p>
    <p><a href="${base}/#/reset/${token}" style="background:#0f766e;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">Choose your password</a></p>
    <p>Then tap <strong>New order</strong>, enter the pickup and drop-off, and you'll see the price right away. Every delivery
      has live tracking and a photo and signature when it's dropped off.${billing === 'invoice' ? ' Deliveries are billed to your company\'s account and invoiced monthly, so there\'s nothing to pay at booking.' : ''}</p>
    <p>Questions? Just reply to this email.</p>
    <p>The Choice Delivery team<br><a href="https://choicedeliverysc.com" style="color:#0f766e">choicedeliverysc.com</a></p>
  </div></div>`,
  });
}

// Tells dispatch (LEADS_EMAIL) that an order is waiting for a manual price.
function notifyStaffOfReview(order) {
  const base = process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
  const bd = order.priceBreakdown || {};
  const reasons = bd.needsReview ? (bd.reviewReasons || []) : [bd.approvalReason].filter(Boolean);
  const approval = !bd.needsReview && bd.needsApproval;
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  sendMail({
    to: process.env.LEADS_EMAIL || 'info@choicedeliverysc.com',
    subject: `${approval ? 'Approval needed' : 'Price review needed'}: ${order.orderNumber}${order.organization ? ` (${order.organization.name})` : order.isGuest ? ` (guest: ${order.customerName})` : ''}`,
    html: `<p><strong>${esc(order.orderNumber)}</strong> ${approval ? `needs your approval (quoted ${money(order.priceCents)})` : 'needs a price'}: ${esc(reasons.join('; '))}.</p>
      <p>${esc(order.vehicleType)} · ${esc(order.weight)} · ${esc(order.stops[0]?.address)} &rarr; ${esc(order.stops[order.stops.length - 1]?.address)}</p>
      <p><a href="${base}/#/orders/${order.id}">${approval ? 'Open the order to approve it or change the price' : 'Open the order and set the price'}</a></p>`,
  }).catch((e) => console.error('Review email failed:', e.message));
}

// Payment request for an order dispatch booked: a "Pay by card" button that opens Stripe's secure
// checkout (a fresh one each time, so the link never expires) until the order is paid.
async function emailPaymentRequest(orderId) {
  const { rows: [o] } = await db.query(
    `SELECT o.*, (SELECT address FROM stops WHERE order_id = o.id ORDER BY sequence LIMIT 1) AS first_address,
            (SELECT address FROM stops WHERE order_id = o.id ORDER BY sequence DESC LIMIT 1) AS last_address
     FROM orders o WHERE o.id = $1`, [orderId]);
  if (!o?.customer_email) return false;
  const base = process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
  const pay = `${base}/public/pay/${o.public_token}`;
  await sendMail({
    to: o.customer_email,
    subject: `Payment for your delivery ${o.order_number}: ${money(o.price_cents)}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
  <div style="background:#0f766e;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0"><strong>Choice Delivery SC</strong></div>
  <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 10px 10px">
    <p>Hi ${esc((o.customer_name || '').split(' ')[0] || 'there')},</p>
    <p>Here's the payment link for your delivery. The total is <strong>${money(o.price_cents)}</strong>.</p>
    <p style="color:#4b5563"><strong>${esc(o.order_number)}</strong><br>${esc(o.first_address)} &rarr; ${esc(o.last_address)}</p>
    <p><a href="${pay}" style="background:#0f766e;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">Pay ${money(o.price_cents)} by card</a></p>
    <p style="color:#6b7280;font-size:12px">Payment is handled by Stripe; we never see your card number.
      <a href="${base}/#/track/${o.public_token}" style="color:#0f766e">Track your delivery</a></p>
  </div></div>`,
  });
  await logOrderEmail(o.id, 'email_sent', { to: o.customer_email, subject: `Payment for your delivery ${o.order_number}: ${money(o.price_cents)}`, kind: 'payment_request', payLink: true });
  return true;
}

// Emails dispatch when a driver's count or seal check didn't match at a chain-of-custody handoff.
async function alertStaffOfCustodyException(orderId, stopId) {
  try {
    const { rows: [e] } = await db.query(
      `SELECT e.data, o.order_number, d.name AS driver_name FROM order_events e JOIN orders o ON o.id = e.order_id
       LEFT JOIN users d ON d.id = e.actor_id
       WHERE e.order_id = $1 AND e.type = 'custody_exception' AND e.data->>'stopId' = $2 ORDER BY e.created_at DESC LIMIT 1`,
      [orderId, String(stopId)]);
    if (!e) return;
    const base = process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
    const where = e.data.type === 'pickup' ? 'pickup' : 'drop-off';
    await sendMail({
      to: staffInbox(),
      subject: `Chain of custody exception: ${e.order_number} (${where})`,
      html: `<p><strong>${esc(e.order_number)}</strong>: at the ${where}, ${esc(e.driver_name || 'the driver')} recorded:</p>
        <ul>${(e.data.problems || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        <p>The handoff was still completed. Check with the driver and the customer.</p>
        <p><a href="${base}/#/orders/${orderId}">Open the order</a></p>`,
    });
  } catch (err) {
    console.error('Custody exception email failed:', err.message);
  }
}

module.exports = { inviteCustomer, alertStaffOfCustodyException, emailShipper, alertStaffOfBooking, alertStaffOfSignup, welcomeShipper, emailPaymentRequest, notifyStaffOfReview };
