// Operational switches for dispatch (currently: bad-weather pricing).
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { asyncH, HttpError } = require('../util');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'dispatcher'));

router.get('/', asyncH(async (req, res) => {
  const { rows } = await db.query('SELECT key, value, updated_at FROM settings');
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

module.exports = router;
