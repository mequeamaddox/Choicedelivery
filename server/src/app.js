const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const resetPage = require('./reset-page');
const { businessPlansEnabled } = require('./pricing');

const app = express();
app.set('trust proxy', 1); // Railway terminates TLS at its proxy
app.use(cors());
// Stripe webhooks need the raw request body, so they're mounted before the JSON parser.
app.use('/webhooks', require('./routes/webhooks'));
// Signatures and photos are sent inline as base64 data URLs.
app.use(express.json({ limit: '15mb' }));

app.get('/payments/config', (req, res) => {
  const stripe = require('./stripe');
  res.json({ enabled: stripe.enabled(), mode: stripe.enabled() ? stripe.mode() : null, webhookReady: stripe.webhookReady() });
});

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, message: 'Database unavailable' });
  }
});

// ---- Public landing page (choicedeliverysc.com) ----
// Chosen by host name; www redirects to the bare domain (normally Cloudflare does that before
// requests reach Railway). API paths (/public/quote, etc.) work on every host, so the landing
// page's forms call this same server. app.choicedeliverysc.com serves the web app and the API
// used by the driver app.
const LANDING_DIR = path.join(__dirname, '..', 'landing');
const LANDING_HOSTS = (process.env.LANDING_HOSTS || 'www.choicedeliverysc.com,choicedeliverysc.com')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
const LANDING_FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/privacy': 'privacy.html',
  '/privacy.html': 'privacy.html',
  '/terms': 'terms.html',
  '/terms.html': 'terms.html',
  '/site.css': 'site.css',
  '/robots.txt': 'robots.txt',
  '/sitemap.xml': 'sitemap.xml',
  '/logo.png': 'logo.png',
  '/favicon.png': 'favicon.png',
  '/favicon.ico': 'favicon.png',
};
// The business-plan parts of the home page are marked <!-- business-plans -->…<!-- /business-plans -->
// (optionally with <!-- business-plans:else --> shown instead when hidden), and /* business-plans */
// in its script. They're left out unless SHOW_BUSINESS_PLANS=true.
const landingCache = new Map();
function landingIndex() {
  const show = businessPlansEnabled();
  if (!landingCache.has(show)) {
    const html = fs.readFileSync(path.join(LANDING_DIR, 'index.html'), 'utf8');
    landingCache.set(show, html
      .replace(/<!-- business-plans -->([\s\S]*?)<!-- \/business-plans -->/g, (m, inner) => {
        const [on, off = ''] = inner.split('<!-- business-plans:else -->');
        return show ? on : off;
      })
      .replace(/\/\* business-plans \*\/([\s\S]*?)\/\* \/business-plans \*\//g, (m, inner) => (show ? inner : '')));
  }
  return landingCache.get(show);
}

app.use((req, res, next) => {
  const host = (req.hostname || '').toLowerCase();
  // The app (logins, orders, tracking links with addresses) stays out of search engines; only the
  // public website is indexed.
  if (!LANDING_HOSTS.includes(host)) {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    if (req.path === '/robots.txt') return res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  }
  if (!LANDING_HOSTS.includes(host) || !['GET', 'HEAD'].includes(req.method)) return next();
  const file = LANDING_FILES[req.path];
  if (!file) return next();
  // One canonical address: www.choicedeliverysc.com -> choicedeliverysc.com
  if (host.startsWith('www.') && LANDING_HOSTS.includes(host.slice(4))) {
    return res.redirect(301, `https://${host.slice(4)}${req.originalUrl}`);
  }
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': /\.(html|txt|xml)$/.test(file) ? 'no-cache' : 'public, max-age=86400' });
  if (file === 'index.html') return res.type('html').send(landingIndex());
  res.sendFile(path.join(LANDING_DIR, file));
});

// ---- Web app (shippers + dispatch) ----
// Served from "/" on every other host; app.choicedeliverysc.com is the intended address. It uses hash
// routes (/#/orders), so it never collides with the API paths below.
const WEB_DIR = path.join(__dirname, '..', 'web');
const webHeaders = (res) => {
  res.set({
    // Stripe's embedded payout form (drivers' bank & debit card page) loads from Stripe's domains.
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org https://*.stripe.com; "
      + "style-src 'self' 'sha256-0hAheEzaMe6uXIKV4EehS9pu1am1lj/KnnzrOYqckXk='; "
      + "script-src 'self' https://connect-js.stripe.com https://js.stripe.com; "
      + "frame-src https://connect-js.stripe.com https://js.stripe.com; "
      + "connect-src 'self' https://api.stripe.com https://connect-js.stripe.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
};
app.get('/', (req, res) => {
  webHeaders(res);
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});
app.use('/static', express.static(path.join(WEB_DIR, 'static'), {
  fallthrough: false,
  setHeaders: (res) => { webHeaders(res); res.set('Cache-Control', 'no-cache'); },
}));

app.use('/auth', require('./routes/auth'));
app.use('/users', require('./routes/users'));
app.use('/organizations', require('./routes/organizations'));
app.use('/orders', require('./routes/orders'));
app.use('/track', require('./routes/track'));
app.use('/public', require('./routes/public'));
app.use('/leads', require('./routes/leads'));
app.use('/settings', require('./routes/settings'));
app.use('/payouts', require('./routes/payouts'));
app.use('/shipping-forms', require('./routes/shipping-forms'));
app.use('/demo', require('./routes/demo'));
app.get('/reset-password', resetPage);

app.use((req, res) => res.status(404).json({ message: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Upload too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON' });
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ message: err.status ? err.message : 'Internal server error' });
});

module.exports = app;
