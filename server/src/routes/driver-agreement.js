// Driver agreement form: drivers read and sign it (#/driver/agreement); dispatch views signed copies.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { asyncH, HttpError } = require('../util');
const agreement = require('../driver-agreement');

const router = express.Router();
router.use(requireAuth);

// The driver's own: the current text, what they signed (if anything), and their details to prefill.
router.get('/', requireRole('driver'), asyncH(async (req, res) => {
  const { rows: [u] } = await db.query('SELECT name, email, phone_number, driver_profile FROM users WHERE id = $1', [req.user.id]);
  res.json({ current: await agreement.current(), signed: await agreement.latestFor(req.user.id),
    prefill: { legalName: u.name || '', phone: u.phone_number || '', email: u.email, city: u.driver_profile?.city || '', zip: u.driver_profile?.zip || '', state: 'SC' } });
}));

router.post('/', requireRole('driver'), asyncH(async (req, res) => {
  res.status(201).json(await agreement.sign(req.user, req.body, req));
}));

// Dispatch: a driver's signed agreement.
router.get('/:userId', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const signed = await agreement.latestFor(req.params.userId).catch(() => null);
  if (!signed) throw new HttpError(404, "This driver hasn't signed the agreement yet");
  const { rows: [u] } = await db.query('SELECT name, email FROM users WHERE id = $1', [req.params.userId]);
  res.json({ ...signed, driver: u });
}));

module.exports = router;
