const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const resetPage = require('./reset-page');

const app = express();
app.set('trust proxy', 1); // Railway terminates TLS at its proxy
app.use(cors());
// Signatures and photos are sent inline as base64 data URLs.
app.use(express.json({ limit: '15mb' }));

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, message: 'Database unavailable' });
  }
});

// ---- Web app (shippers + dispatch) ----
// Served from "/" on every host; app.choicedeliverysc.com is the intended address. It uses hash
// routes (/#/orders), so it never collides with the API paths below.
const WEB_DIR = path.join(__dirname, '..', 'web');
const webHeaders = (res) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; "
      + "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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
