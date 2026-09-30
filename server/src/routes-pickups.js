const express = require('express');
const db = require('./db');
const { requireAuth, requireAdmin } = require('./auth');
const { notifyDriversOfPickup } = require('./push');

const router = express.Router();
const asyncH = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Fields a dispatcher/admin may set when creating or editing a pickup.
const EDITABLE = [
  'status', 'contact_name', 'contact_phone', 'pickup_address', 'destination_address',
  'weight', 'number_of_pieces', 'vehicle_type', 'tracking_number', 'pickup_date',
  'pickup_location', 'delivery_location', 'driver_id',
];
const JSON_FIELDS = new Set(['pickup_location', 'delivery_location']);

// The app keys lists by request_id and reads driverId; keep both for compatibility.
const serialize = (p) => p && ({ ...p, request_id: p.id, driverId: p.driver_id });

async function loadVisible(req, id) {
  const { rows } = await db.query('SELECT * FROM pickups WHERE id = $1', [id]);
  const p = rows[0];
  if (!p) return null;
  if (req.user.role === 'admin') return p;
  if (p.driver_id === req.user.id || p.status.toLowerCase() === 'pending') return p;
  return null;
}

router.use(requireAuth);

// GET /pickups?status=pending   — drivers see pending jobs plus their own; admins see all.
router.get('/', asyncH(async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.status) {
    params.push(String(req.query.status).toLowerCase());
    where.push(`lower(status) = $${params.length}`);
  }
  if (req.user.role !== 'admin') {
    params.push(req.user.id);
    where.push(`(lower(status) = 'pending' OR driver_id = $${params.length})`);
  }
  const { rows } = await db.query(
    `SELECT * FROM pickups ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pickup_date DESC`,
    params
  );
  res.json(rows.map(serialize));
}));

// GET /pickups/mine?status=Completed — the signed-in driver's jobs.
router.get('/mine', asyncH(async (req, res) => {
  const params = [req.user.id];
  let sql = 'SELECT * FROM pickups WHERE driver_id = $1';
  if (req.query.status) {
    params.push(String(req.query.status).toLowerCase());
    sql += ' AND lower(status) = $2';
  }
  const { rows } = await db.query(sql + ' ORDER BY COALESCE(delivered_at, updated_at) DESC', params);
  res.json(rows.map(serialize));
}));

// Barcode scan: mark a shipment picked up by its tracking number.
router.post('/scan', asyncH(async (req, res) => {
  const barcode = req.body?.barcode;
  if (!barcode) return res.status(400).json({ message: 'barcode is required' });
  const { rows } = await db.query(
    `UPDATE pickups SET status = 'picked up', driver_id = COALESCE(driver_id, $2), updated_at = now()
     WHERE tracking_number = $1 AND lower(status) IN ('pending', 'accepted')
       AND (driver_id IS NULL OR driver_id = $2) RETURNING *`,
    [barcode, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'No open shipment found for that barcode' });
  res.json(serialize(rows[0]));
}));

router.get('/:id', asyncH(async (req, res) => {
  const p = await loadVisible(req, req.params.id);
  if (!p) return res.status(404).json({ message: 'Pickup not found' });
  res.json(serialize(p));
}));

// Claim a pending pickup. Atomic, so two drivers can't accept the same job.
router.post('/:id/accept', asyncH(async (req, res) => {
  const { rows } = await db.query(
    `UPDATE pickups SET status = 'Accepted', driver_id = $2, updated_at = now()
     WHERE id = $1 AND (lower(status) = 'pending' OR driver_id = $2) RETURNING *`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(409).json({ message: 'This pickup is no longer available' });
  res.json(serialize(rows[0]));
}));

// Driver-driven status changes on an assigned job.
const DRIVER_STATUSES = new Set(['picked up', 'in transit', 'delivered']);
router.post('/:id/status', asyncH(async (req, res) => {
  const status = req.body?.status;
  if (!status || !DRIVER_STATUSES.has(status.toLowerCase())) {
    return res.status(400).json({ message: `status must be one of: ${[...DRIVER_STATUSES].join(', ')}` });
  }
  const { rows } = await db.query(
    'UPDATE pickups SET status = $2, updated_at = now() WHERE id = $1 AND driver_id = $3 RETURNING *',
    [req.params.id, status, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Pickup not found or not assigned to you' });
  res.json(serialize(rows[0]));
}));

router.post('/:id/confirm-pickup', asyncH(async (req, res) => {
  const { signature, image } = req.body || {};
  if (!signature && !image) return res.status(400).json({ message: 'A signature or photo is required' });
  const { rows } = await db.query(
    `UPDATE pickups SET status = 'In Transit', pickup_signature = $2, pickup_image = $3,
       picked_up_at = now(), updated_at = now()
     WHERE id = $1 AND driver_id = $4 RETURNING *`,
    [req.params.id, signature || null, image || null, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Pickup not found or not assigned to you' });
  res.json(serialize(rows[0]));
}));

router.post('/:id/complete', asyncH(async (req, res) => {
  const { signature, image, printedName } = req.body || {};
  if (!signature && !image) return res.status(400).json({ message: 'A signature or photo is required' });
  const { rows } = await db.query(
    `UPDATE pickups SET status = 'Completed', delivery_signature = $2, delivery_image = $3,
       printed_name = $4, delivered_at = now(), updated_at = now()
     WHERE id = $1 AND driver_id = $5 RETURNING *`,
    [req.params.id, signature || null, image || null, printedName, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Pickup not found or not assigned to you' });
  res.json(serialize(rows[0]));
}));

router.post('/:id/notes', asyncH(async (req, res) => {
  const note = (req.body?.note || '').trim();
  if (!note) return res.status(400).json({ message: 'note is required' });
  const entry = { note, driverId: req.user.id, createdAt: new Date().toISOString() };
  const { rows } = await db.query(
    `UPDATE pickups SET notes = notes || $2::jsonb, updated_at = now()
     WHERE id = $1 AND (driver_id = $3 OR $4) RETURNING *`,
    [req.params.id, JSON.stringify([entry]), req.user.id, req.user.role === 'admin']
  );
  if (!rows[0]) return res.status(404).json({ message: 'Pickup not found or not assigned to you' });
  res.json(serialize(rows[0]));
}));

// ---- Admin / dispatch (JWT with admin role, or DISPATCH_API_KEY) ----

function pickEditable(body) {
  const cols = [];
  const vals = [];
  for (const f of EDITABLE) {
    if (body[f] !== undefined) {
      cols.push(f);
      vals.push(JSON_FIELDS.has(f) && body[f] !== null ? JSON.stringify(body[f]) : body[f]);
    }
  }
  return { cols, vals };
}

router.post('/', requireAdmin, asyncH(async (req, res) => {
  const body = req.body || {};
  const { cols, vals } = pickEditable(body);
  if (body.id || body.request_id) { cols.push('id'); vals.push(String(body.id || body.request_id)); }
  const placeholders = vals.map((_, i) => `$${i + 1}`);
  const { rows } = await db.query(
    cols.length
      ? `INSERT INTO pickups (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`
      : 'INSERT INTO pickups DEFAULT VALUES RETURNING *',
    vals
  );
  const pickup = rows[0];
  if (pickup.status.toLowerCase() === 'pending') {
    notifyDriversOfPickup(pickup).catch((e) => console.error('Push notify failed:', e));
  }
  res.status(201).json(serialize(pickup));
}));

router.patch('/:id', requireAdmin, asyncH(async (req, res) => {
  const { cols, vals } = pickEditable(req.body || {});
  if (!cols.length) return res.status(400).json({ message: 'No editable fields supplied' });
  const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const { rows } = await db.query(
    `UPDATE pickups SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
    [req.params.id, ...vals]
  );
  if (!rows[0]) return res.status(404).json({ message: 'Pickup not found' });
  res.json(serialize(rows[0]));
}));

router.delete('/:id', requireAdmin, asyncH(async (req, res) => {
  await db.query('DELETE FROM pickups WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
