// Public, no-login tracking page data for a shareable link: /track/<public token>.
const express = require('express');
const db = require('../db');
const { asyncH, HttpError } = require('../util');
const { ACTIVE } = require('../orders');

const router = express.Router();

router.get('/:token', asyncH(async (req, res) => {
  const { rows } = await db.query(
    `SELECT o.id, o.order_number, o.status, o.completed_at, o.created_at,
            d.id AS driver_id, d.name AS driver_name, d.last_location, d.location_updated_at,
            (SELECT concat_ws(' ', NULLIF(v.color, ''), NULLIF(v.make, ''), NULLIF(v.model, '')) FROM vehicles v
             WHERE v.driver_id = d.id ORDER BY v.created_at LIMIT 1) AS driver_vehicle,
            (SELECT dd.updated_at FROM driver_documents dd WHERE dd.user_id = d.id AND dd.kind = 'photo') AS driver_photo_at
     FROM orders o LEFT JOIN users d ON d.id = o.driver_id
     WHERE o.public_token = $1 AND o.status <> 'quote'`, [req.params.token]).catch(() => ({ rows: [] }));
  const o = rows[0];
  if (!o) throw new HttpError(404, 'Tracking link not found');
  const { rows: stops } = await db.query(
    'SELECT type, status, address, location, arrived_at, completed_at FROM stops WHERE order_id = $1 ORDER BY sequence', [o.id]);
  res.json({
    orderNumber: o.order_number,
    status: o.status,
    createdAt: o.created_at,
    completedAt: o.completed_at,
    driver: o.driver_name ? {
      name: o.driver_name.split(' ')[0],
      vehicle: o.driver_vehicle || null,
      photoUrl: o.driver_photo_at ? `/public/driver-photo/${o.driver_id}?v=${new Date(o.driver_photo_at).getTime()}` : null,
      ...(ACTIVE.includes(o.status) ? { location: o.last_location, locationUpdatedAt: o.location_updated_at } : {}),
    } : null,
    stops: stops.map((s) => ({
      type: s.type, status: s.status, address: s.address, location: s.location, arrivedAt: s.arrived_at, completedAt: s.completed_at,
    })),
  });
}));

module.exports = router;
