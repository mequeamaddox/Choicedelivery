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
    err.code = data.error?.code;
    throw err;
  }
  return data;
}

function createCheckoutSession({
  orderId, orderNumber, amountCents, description, customerEmail, successUrl, cancelUrl, name, metadata = {},
}) {
  return stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: customerEmail || undefined,
    client_reference_id: orderId,
    metadata: { order_id: orderId, order_number: orderNumber, ...metadata },
    payment_intent_data: { metadata: { order_id: orderId, order_number: orderNumber, ...metadata } },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        product_data: { name: name || `Choice Delivery ${orderNumber}`, description: description || undefined },
      },
    }],
  });
}

const expireCheckoutSession = (id) => stripeRequest('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`, {});

const refund = (paymentIntent, amountCents, orderId) => stripeRequest(
  'POST', '/refunds', { payment_intent: paymentIntent, amount: amountCents, metadata: { order_id: orderId } },
  { idempotencyKey: `refund-${orderId}` }
);

const WEBHOOK_EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
const mode = () => (String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_') ? 'live' : 'test');

// Signing secret of the webhook this server created (see ensureWebhook), cached from the settings table.
let storedSecret = null;

// Creates the Stripe webhook endpoint automatically (so nobody has to copy a signing secret by hand)
// and remembers its secret in the settings table. Re-creates it if the URL or test/live mode changes.
// Skipped when STRIPE_WEBHOOK_SECRET is set manually.
async function ensureWebhook(db) {
  if (!enabled() || process.env.STRIPE_WEBHOOK_SECRET) return { status: enabled() ? 'manual' : 'off' };
  const base = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (!base.startsWith('https://')) return { status: 'waiting', reason: 'Set PUBLIC_URL to https://app.choicedeliverysc.com' };
  const url = `${base}/webhooks/stripe`;
  const { rows } = await db.query("SELECT value FROM settings WHERE key = 'stripe_webhook'");
  const saved = rows[0]?.value;
  if (saved?.url === url && saved?.mode === mode() && saved?.secret) {
    storedSecret = saved.secret;
    return { status: 'ready', url, mode: mode() };
  }
  // Remove endpoints for this same URL left over from earlier setups (their secrets can't be read back).
  const existing = await stripeRequest('GET', '/webhook_endpoints?limit=100');
  for (const ep of existing.data || []) {
    if (ep.url === url) await stripeRequest('DELETE', `/webhook_endpoints/${encodeURIComponent(ep.id)}`);
  }
  const created = await stripeRequest('POST', '/webhook_endpoints', {
    url, enabled_events: WEBHOOK_EVENTS, description: 'Choice Delivery payments (created automatically)',
  });
  const value = { id: created.id, url, mode: mode(), secret: created.secret };
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('stripe_webhook', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(value)]);
  storedSecret = created.secret;
  return { status: 'created', url, mode: mode() };
}

const webhookReady = () => !!(process.env.STRIPE_WEBHOOK_SECRET || storedSecret);

// Verifies the Stripe-Signature header (HMAC-SHA256 of "timestamp.payload") and returns the event.
function verifyWebhook(rawBody, header, secret = process.env.STRIPE_WEBHOOK_SECRET || storedSecret, toleranceSec = 300) {
  if (!secret) throw Object.assign(new Error('Stripe webhook is not set up yet'), { status: 503 });
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

// ---- Stripe Connect: paying drivers ----
// Each driver gets an Express account. Stripe hosts the sign-up (identity, bank account, tax info)
// and pays out to the driver's bank; we send money to it from the platform balance with a transfer.
const createDriverAccount = ({ userId, email }) => stripeRequest('POST', '/accounts', {
  type: 'express',
  country: 'US',
  email: email || undefined,
  business_type: 'individual',
  capabilities: { transfers: { requested: true } },
  business_profile: { mcc: '4215', product_description: 'Independent delivery driver for Choice Delivery SC' },
  metadata: { user_id: userId },
// Keyed per minute: a double tap creates one account, but a retry later (say, after Connect was switched
// on) isn't answered with Stripe's saved reply to the earlier failed attempt, which it keeps for 24 hours.
}, { idempotencyKey: `driver-account-${userId}-${Math.floor(Date.now() / 60000)}` });

const getAccount = (accountId) => stripeRequest('GET', `/accounts/${encodeURIComponent(accountId)}`);

const createAccountLink = ({ accountId, refreshUrl, returnUrl }) => stripeRequest('POST', '/account_links', {
  account: accountId, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding',
});

// Link to the driver's own Stripe Express dashboard (payout history, bank account, tax forms).
const createLoginLink = (accountId) => stripeRequest('POST', `/accounts/${encodeURIComponent(accountId)}/login_links`, {});

// Sends a payout. The payout id makes retries safe: Stripe won't send the same payout twice.
const transferToDriver = ({ payoutId, accountId, cents, description }) => stripeRequest('POST', '/transfers', {
  amount: cents, currency: 'usd', destination: accountId, description,
  transfer_group: `payout-${payoutId}`, metadata: { payout_id: payoutId },
}, { idempotencyKey: `payout-${payoutId}` });

module.exports = {
  enabled, mode, setFetch, createCheckoutSession, expireCheckoutSession, refund, verifyWebhook, encode,
  ensureWebhook, webhookReady,
  createDriverAccount, getAccount, createAccountLink, createLoginLink, transferToDriver,
};
