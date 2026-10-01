// Operational switches for dispatch (currently: bad-weather pricing).
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { asyncH, HttpError } = require('../util');
const { normalizeFees, getFees, DEFAULT_FEES } = require('../pricing');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'dispatcher'));

router.get('/', asyncH(async (req, res) => {
  // Internal values (e.g. the Stripe webhook signing secret) are never exposed.
  const { rows } = await db.query("SELECT key, value, updated_at FROM settings WHERE key <> 'stripe_webhook'");
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}));

router.put('/bad-weather', asyncH(async (req, res) => {
  if (typeof req.body?.enabled !== 'boolean') throw new HttpError(400, 'enabled must be true or false');
  await db.query(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('bad_weather', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(req.body.enabled), req.user.id]
  );
  res.json({ bad_weather: req.body.enabled });
}));

// Email (Resend) status and a test send to the signed-in owner, so setup can be checked from the Account page.
router.get('/email', requireRole('admin'), asyncH(async (req, res) => {
  res.json({ configured: !!process.env.RESEND_API_KEY, from: process.env.MAIL_FROM || 'Choice Delivery <onboarding@resend.dev>' });
}));

router.post('/email/test', requireRole('admin'), asyncH(async (req, res) => {
  if (!process.env.RESEND_API_KEY) throw new HttpError(409, 'RESEND_API_KEY is not set in Railway yet');
  const { rows: [me] } = await db.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
  try {
    await require('../mailer').sendMail({
      to: me.email,
      subject: 'Choice Delivery test email',
      html: '<p>Email is working. Shippers and drivers will now get their Choice Delivery emails.</p>',
    });
  } catch (e) {
    // Resend explains what's wrong (e.g. the domain isn't verified yet), so pass that along.
    throw new HttpError(502, e.message.replace(/^Email send failed: /, 'Resend said: '));
  }
  res.json({ message: `Sent to ${me.email}. Check your inbox (and spam folder).` });
}));

// The driver app's install link (e.g. the latest EAS build or Play Store page). Owner only.
router.put('/driver-app', requireRole('admin'), asyncH(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (url && !/^https:\/\/\S+$/.test(url)) throw new HttpError(400, 'Enter a link starting with https://');
  await db.query(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('driver_app_url', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(url || null), req.user.id]);
  res.json({ url: url || null });
}));

// Weight tiers, extra stop, add-on and wait-time amounts. Owner (admin) only.
router.get('/fees', asyncH(async (req, res) => {
  res.json({ fees: await getFees(db), defaults: normalizeFees(DEFAULT_FEES) });
}));

router.put('/fees', requireRole('admin'), asyncH(async (req, res) => {
  const b = req.body || {};
  if (!Array.isArray(b.weightTiers) || !b.weightTiers.length) throw new HttpError(400, 'weightTiers is required');
  const fees = normalizeFees(b);
  await db.query(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('fees', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(fees), req.user.id]);
  res.json({ fees });
}));

module.exports = router;
