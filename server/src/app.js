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

app.use('/auth', require('./routes/auth'));
app.use('/users', require('./routes/users'));
app.use('/organizations', require('./routes/organizations'));
app.use('/orders', require('./routes/orders'));
app.use('/track', require('./routes/track'));
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
