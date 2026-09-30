// Minimal Stripe client (Checkout Sessions, refunds, webhook verification) using fetch,
// so no SDK is needed. Payments are on when STRIPE_SECRET_KEY is set.
const crypto = require('crypto');

let fetchImpl = (...args) => fetch(...args);
const setFetch = (fn) => { fetchImpl = fn; }; // for tests

const enabled = () => !!process.env.STRIPE_SECRET_KEY;

// Stripe takes form-encoded bodies with bracketed keys: line_items[0][price_data][currency]=usd
function encode(params, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripeRequest(method, path, params, { idempotencyKey } = {}) {
  if (!enabled()) throw Object.assign(new Error('Payments are not set up yet'), { status: 503 });
  const headers = { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` };
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetchImpl(`https://api.stripe.com/v1${path}`, {
    method, headers, body: params ? encode(params).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `Stripe error ${res.status}`);
    err.status = 502;
    throw err;
  }
  return data;
}

function createCheckoutSession({ orderId, orderNumber, amountCents, description, customerEmail, successUrl, cancelUrl }) {
  return stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail || undefined,
    client_reference_id: orderId,
    metadata: { order_id: orderId, order_number: orderNumber },
    payment_intent_data: { metadata: { order_id: orderId, order_number: orderNumber } },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        product_data: { name: `Choice Delivery ${orderNumber}`, description: description || undefined },
      },
    }],
  });
}

const expireCheckoutSession = (id) => stripeRequest('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`, {});

const refund = (paymentIntent, amountCents, orderId) => stripeRequest(
  'POST', '/refunds', { payment_intent: paymentIntent, amount: amountCents, metadata: { order_id: orderId } },
  { idempotencyKey: `refund-${orderId}` }
);

// Verifies the Stripe-Signature header (HMAC-SHA256 of "timestamp.payload") and returns the event.
function verifyWebhook(rawBody, header, secret = process.env.STRIPE_WEBHOOK_SECRET, toleranceSec = 300) {
  if (!secret) throw Object.assign(new Error('STRIPE_WEBHOOK_SECRET is not set'), { status: 503 });
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')).filter((p) => p.length === 2)
    .map(([k, v]) => [k.trim(), v.trim()]));
  const signatures = String(header || '').split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  const timestamp = Number(parts.t);
  if (!timestamp || !signatures.length) throw Object.assign(new Error('Missing Stripe signature'), { status: 400 });
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSec) {
    throw Object.assign(new Error('Stripe signature timestamp too old'), { status: 400 });
  }
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
  const ok = signatures.some((sig) => sig.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')));
  if (!ok) throw Object.assign(new Error('Invalid Stripe signature'), { status: 400 });
  return JSON.parse(rawBody.toString('utf8'));
}

module.exports = { enabled, setFetch, createCheckoutSession, expireCheckoutSession, refund, verifyWebhook, encode };
