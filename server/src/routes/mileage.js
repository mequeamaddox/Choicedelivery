// Mileage log: drivers see and add to their own; staff can see and add to any driver's.
const express = require('express');
const db = require('../db');
const { requireAuth, isStaff } = require('../auth');
const { asyncH, HttpError, str } = require('../util');
const { mileageLog } = require('../mileage');
const { localTime } = require('../pricing');

const router = express.Router();
router.use(requireAuth);

// Whose log: staff may pass driverId; drivers always get their own.
async function targetDriver(req) {
  const id = isStaff(req.user) && req.query.driverId ? String(req.query.driverId) : req.user.id;
  if (!id) throw new HttpError(400, 'Integration keys have no mileage log');
  const { rows: [u] } = await db.query('SELECT id, role FROM users WHERE id::text = $1', [id]);
  if (!u || u.role !== 'driver') throw new HttpError(isStaff(req.user) ? 404 : 403, 'Mileage logs are for drivers');
  return u.id;
}

router.get('/', asyncH(async (req, res) => {
  const driverId = await targetDriver(req);
  const thisYear = Number(localTime(new Date()).date.slice(0, 4));
  const year = Number.parseInt(req.query.year, 10);
  res.json(await mileageLog(db, driverId, year >= 2020 && year <= thisYear + 1 ? year : thisYear));
}));

// A trip the app didn't track (phone off, supply run, etc.).
router.post('/entries', asyncH(async (req, res) => {
  const driverId = await targetDriver(req);
  const day = str(req.body?.day);
  const miles = Math.round(Number(req.body?.miles) * 10) / 10;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) throw new HttpError(400, 'Pick a date');
  if (day > localTime(new Date()).date) throw new HttpError(400, "That date hasn't happened yet");
  if (!(miles > 0 && miles <= 2000)) throw new HttpError(400, 'Miles must be between 0.1 and 2,000');
  const { rows: [e] } = await db.query(
    'INSERT INTO mileage_entries (driver_id, day, miles, note) VALUES ($1, $2, $3, $4) RETURNING id',
    [driverId, day, miles, str(req.body?.note).slice(0, 200)]);
  res.status(201).json({ id: e.id });
}));

router.delete('/entries/:id', asyncH(async (req, res) => {
  const driverId = await targetDriver(req);
  const { rowCount } = await db.query('DELETE FROM mileage_entries WHERE id::text = $1 AND driver_id = $2', [req.params.id, driverId]);
  if (!rowCount) throw new HttpError(404, 'Trip not found');
  res.json({ ok: true });
}));

module.exports = router;
