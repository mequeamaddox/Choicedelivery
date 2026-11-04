// Gig work for the owner and drivers: import a route from gig-app screenshots, work through it next to
// Choice Delivery jobs, and log each shift's pay, tips and miles. Everyone sees only their own.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { asyncH, HttpError, str } = require('../util');
const gig = require('../gig');
const { ACTIVE } = require('../orders');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'dispatcher', 'driver'));

const serializeStop = (s) => ({ id: s.id, sequence: s.sequence, address: s.address, note: s.note, location: s.location || null, located: s.located, doneAt: s.done_at });

async function loadRoute(userId, id) {
  const { rows: [r] } = await db.query('SELECT * FROM gig_routes WHERE id = $1 AND user_id = $2', [id, userId]).catch(() => ({ rows: [] }));
  if (!r) throw new HttpError(404, 'Route not found');
  const { rows: stops } = await db.query('SELECT * FROM gig_stops WHERE route_id = $1 ORDER BY sequence', [r.id]);
  return {
    id: r.id, app: r.app, status: r.status, createdAt: r.created_at, finishedAt: r.finished_at,
    stops: stops.map(serializeStop), estimatedMiles: gig.routeMiles(stops), locating: stops.some((s) => !s.located),
  };
}

router.get('/', asyncH(async (req, res) => {
  await gig.purgeOldStops();
  const { rows } = await db.query("SELECT id FROM gig_routes WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 5", [req.user.id]);
  const routes = [];
  for (const r of rows) routes.push(await loadRoute(req.user.id, r.id));
  // Choice Delivery jobs to fit in: the user's own active jobs, plus open jobs waiting for a driver.
  const { rows: jobs } = await db.query(
    `SELECT o.id, o.order_number, o.status, o.service_level, s.type, s.address, s.location
     FROM orders o JOIN stops s ON s.order_id = o.id
     WHERE NOT o.is_demo AND s.status <> 'completed' AND s.location IS NOT NULL
       AND ((o.driver_id = $1 AND o.status = ANY($2)) OR (o.status = 'pending' AND o.driver_id IS NULL AND o.payment_status <> 'unpaid'))
     ORDER BY o.created_at, s.sequence LIMIT 60`, [req.user.id, ACTIVE]);
  res.json({
    apps: gig.APPS, aiEnabled: gig.aiEnabled(), routes,
    jobs: jobs.map((j) => ({ orderId: j.id, orderNumber: j.order_number, mine: j.status !== 'pending', rush: j.service_level === 'rush', type: j.type, address: j.address, location: j.location })),
  });
}));

// Reads the stops off screenshots or pasted text, for the driver to check before saving the route.
router.post('/extract', asyncH(async (req, res) => {
  const b = req.body || {};
  res.json(await gig.extractStops({ images: Array.isArray(b.images) ? b.images : [], text: b.text }));
}));

router.post('/routes', asyncH(async (req, res) => {
  const b = req.body || {};
  const stops = (Array.isArray(b.stops) ? b.stops : []).map((s) => ({ address: str(s?.address).slice(0, 300), note: str(s?.note).slice(0, 200) }))
    .filter((s) => s.address).slice(0, 80);
  if (!stops.length) throw new HttpError(400, 'Add at least one stop');
  const id = await db.withTx(async (client) => {
    const { rows: [r] } = await client.query('INSERT INTO gig_routes (user_id, app) VALUES ($1, $2) RETURNING id', [req.user.id, str(b.app).slice(0, 40)]);
    for (const [i, s] of stops.entries()) {
      await client.query('INSERT INTO gig_stops (route_id, sequence, address, note) VALUES ($1, $2, $3, $4)', [r.id, i + 1, s.address, s.note]);
    }
    return r.id;
  });
  gig.locateRoute(id).catch((e) => console.error('Gig route lookup failed:', e.message));
  res.status(201).json(await loadRoute(req.user.id, id));
}));

router.get('/routes/:id', asyncH(async (req, res) => res.json(await loadRoute(req.user.id, req.params.id))));

// Reorders the stops not done yet, nearest first, from the phone's location if given.
router.post('/routes/:id/optimize', asyncH(async (req, res) => {
  const route = await loadRoute(req.user.id, req.params.id);
  const from = req.body?.from && Number.isFinite(Number(req.body.from.lat)) && Number.isFinite(Number(req.body.from.lng))
    ? { lat: Number(req.body.from.lat), lng: Number(req.body.from.lng) } : null;
  const ordered = gig.nearestOrder(route.stops.map((s) => ({ ...s, done_at: s.doneAt })), from);
  await db.withTx(async (client) => {
    for (const [i, s] of ordered.entries()) await client.query('UPDATE gig_stops SET sequence = $2 WHERE id = $1', [s.id, i + 1]);
  });
  res.json(await loadRoute(req.user.id, route.id));
}));

router.patch('/stops/:id', asyncH(async (req, res) => {
  const { rows: [s] } = await db.query(
    'SELECT s.id, s.route_id FROM gig_stops s JOIN gig_routes r ON r.id = s.route_id WHERE s.id = $1 AND r.user_id = $2',
    [req.params.id, req.user.id]).catch(() => ({ rows: [] }));
  if (!s) throw new HttpError(404, 'Stop not found');
  const b = req.body || {};
  if (b.done !== undefined) await db.query('UPDATE gig_stops SET done_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1', [s.id, b.done === true]);
  if (b.address !== undefined && str(b.address)) {
    await db.query('UPDATE gig_stops SET address = $2, location = NULL, located = false WHERE id = $1', [s.id, str(b.address).slice(0, 300)]);
    gig.locateRoute(s.route_id).catch(() => {});
  }
  res.json(await loadRoute(req.user.id, s.route_id));
}));

router.delete('/stops/:id', asyncH(async (req, res) => {
  const { rows: [s] } = await db.query(
    'DELETE FROM gig_stops s USING gig_routes r WHERE r.id = s.route_id AND s.id = $1 AND r.user_id = $2 RETURNING s.route_id',
    [req.params.id, req.user.id]).catch(() => ({ rows: [] }));
  if (!s) throw new HttpError(404, 'Stop not found');
  res.json(await loadRoute(req.user.id, s.route_id));
}));

// Done with the route: its addresses are deleted a day later; the shift log (no addresses) stays.
router.post('/routes/:id/finish', asyncH(async (req, res) => {
  const route = await loadRoute(req.user.id, req.params.id);
  await db.query("UPDATE gig_routes SET status = 'done', finished_at = now() WHERE id = $1", [route.id]);
  res.json({ ...route, status: 'done' });
}));

router.delete('/routes/:id', asyncH(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM gig_routes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]).catch(() => ({ rowCount: 0 }));
  if (!rowCount) throw new HttpError(404, 'Route not found');
  res.status(204).end();
}));

// The shift log: what each gig shift paid, for income and taxes.
const serializeShift = (s) => ({
  id: s.id, day: s.day, app: s.app, hours: s.hours == null ? null : Number(s.hours), payCents: s.pay_cents, tipsCents: s.tips_cents,
  miles: s.miles == null ? null : Number(s.miles), stops: s.stops, note: s.note,
});

router.get('/shifts', asyncH(async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const { rows } = await db.query(
    `SELECT id, to_char(day, 'YYYY-MM-DD') AS day, app, hours, pay_cents, tips_cents, miles, stops, note FROM gig_shifts
     WHERE user_id = $1 AND extract(year FROM day) = $2 ORDER BY day DESC, created_at DESC`, [req.user.id, year]);
  res.json({ year, shifts: rows.map(serializeShift) });
}));

router.post('/shifts', asyncH(async (req, res) => {
  const b = req.body || {};
  const day = str(b.day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'Enter the date');
  const app = str(b.app).slice(0, 40);
  if (!app) throw new HttpError(400, 'Choose the app');
  const cents = (v) => { const n = Math.round(Number(v || 0)); if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new HttpError(400, 'Check the amounts'); return n; };
  const num = (v, max) => { if (v === '' || v == null) return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > max) throw new HttpError(400, 'Check the hours and miles'); return n; };
  const { rows: [s] } = await db.query(
    `INSERT INTO gig_shifts (user_id, day, app, hours, pay_cents, tips_cents, miles, stops, note) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, to_char(day, 'YYYY-MM-DD') AS day, app, hours, pay_cents, tips_cents, miles, stops, note`,
    [req.user.id, day, app, num(b.hours, 24), cents(b.payCents), cents(b.tipsCents), num(b.miles, 2000),
      b.stops == null || b.stops === '' ? null : Math.round(num(b.stops, 500)), str(b.note).slice(0, 300)]);
  res.status(201).json(serializeShift(s));
}));

router.delete('/shifts/:id', asyncH(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM gig_shifts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]).catch(() => ({ rowCount: 0 }));
  if (!rowCount) throw new HttpError(404, 'Shift not found');
  res.status(204).end();
}));

module.exports = router;
