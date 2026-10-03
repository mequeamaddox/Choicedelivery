// Shipping forms: who's sending, who's receiving, and what. Saving one gives it a code (CDS + 8
// digits) that's printed as a Code 128 barcode on the label. Shippers see their company's forms;
// staff see all of them.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireRole, isStaff } = require('../auth');
const { asyncH, HttpError, str } = require('../util');
const { getOrderFor } = require('../orders');

const router = express.Router();
router.use(requireAuth);

const clip = (v, n) => str(v).slice(0, n);
function party(input, label) {
  const p = input && typeof input === 'object' ? input : {};
  const out = {
    name: clip(p.name, 120), company: clip(p.company, 120), address: clip(p.address, 300),
    phone: clip(p.phone, 40), email: clip(p.email, 160),
  };
  if (!out.name && !out.company) throw new HttpError(400, `${label} name is required`);
  if (!out.address) throw new HttpError(400, `${label} address is required`);
  return out;
}
const serialize = (r) => ({
  id: r.id, code: r.code, shipper: r.shipper, recipient: r.recipient, pieces: r.pieces,
  weightLbs: r.weight_lbs == null ? null : Number(r.weight_lbs), description: r.description, reference: r.reference,
  instructions: r.instructions, createdAt: r.created_at, createdBy: r.created_by_name || null,
  orders: r.orders || [],
});
const newCode = () => `CDS${String(crypto.randomInt(0, 1e8)).padStart(8, '0')}`;

// Shippers: their company's forms. Staff: everyone's.
function scope(user, params) {
  if (isStaff(user)) return 'true';
  if (user.organization_id) { params.push(user.organization_id); return `f.organization_id = $${params.length}`; }
  params.push(user.id); return `f.created_by = $${params.length}`;
}
const SELECT = `SELECT f.*, u.name AS created_by_name,
  (SELECT coalesce(json_agg(json_build_object('id', o.id, 'orderNumber', o.order_number, 'status', o.status) ORDER BY o.created_at), '[]')
     FROM orders o WHERE o.id = f.order_id OR (o.tracking_number = f.code AND (f.organization_id IS NULL OR o.organization_id = f.organization_id))) AS orders
  FROM shipping_forms f LEFT JOIN users u ON u.id = f.created_by`;

router.post('/', requireRole('admin', 'dispatcher', 'shipper'), asyncH(async (req, res) => {
  const b = req.body || {};
  const shipper = party(b.shipper, 'Shipper');
  const recipient = party(b.recipient, 'Recipient');
  const pieces = b.pieces === '' || b.pieces == null ? null : Number.parseInt(b.pieces, 10);
  if (pieces != null && !(pieces > 0 && pieces < 10000)) throw new HttpError(400, 'Pieces must be a whole number');
  const weight = b.weightLbs === '' || b.weightLbs == null ? null : Number(b.weightLbs);
  if (weight != null && !(weight > 0 && weight < 100000)) throw new HttpError(400, 'Weight must be a number of pounds');
  for (let attempt = 0; ; attempt++) {
    try {
      const { rows: [row] } = await db.query(
        `INSERT INTO shipping_forms (code, created_by, organization_id, shipper, recipient, pieces, weight_lbs, description, reference, instructions)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [newCode(), req.user.id, req.user.organization_id || null, JSON.stringify(shipper), JSON.stringify(recipient), pieces, weight,
          clip(b.description, 500) || null, clip(b.reference, 80) || null, clip(b.instructions, 1000) || null]);
      const { rows: [f] } = await db.query(`${SELECT} WHERE f.id = $1`, [row.id]);
      return res.status(201).json(serialize(f));
    } catch (e) {
      if (e.code === '23505' && attempt < 5) continue; // code already used: pick another
      throw e;
    }
  }
}));

// A shipping form for an order already booked: filled in from the order (first pickup = shipper,
// last drop-off = recipient). One per order; asking again returns the same form. The driver app's
// barcode scan finds the order from the form's code.
router.post('/from-order/:orderId', requireRole('admin', 'dispatcher', 'shipper'), asyncH(async (req, res) => {
  const order = await getOrderFor(req.user, req.params.orderId).catch(() => null);
  if (!order || order.status === 'quote') throw new HttpError(404, 'Order not found');
  const existing = await db.query(`${SELECT} WHERE f.order_id = $1`, [order.id]);
  if (existing.rows[0]) return res.json(serialize(existing.rows[0]));
  const pickup = order.stops.find((s) => s.type === 'pickup') || order.stops[0];
  const dropoff = [...order.stops].reverse().find((s) => s.type === 'dropoff') || order.stops[order.stops.length - 1];
  const party = (s, company) => ({ name: clip(s.contactName, 120), company: clip(company, 120), address: clip(s.address, 300),
    phone: clip(s.contactPhone, 40), email: '' });
  const pieces = Number.parseInt(order.numberOfPieces, 10);
  const weight = Number.parseFloat(String(order.weight || '').replace(/,/g, ''));
  for (let attempt = 0; ; attempt++) {
    try {
      const { rows: [row] } = await db.query(
        `INSERT INTO shipping_forms (code, created_by, organization_id, shipper, recipient, pieces, weight_lbs, description, reference, instructions, order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [newCode(), req.user.id, order.organization?.id || null, JSON.stringify(party(pickup, order.organization?.name)),
          JSON.stringify(party(dropoff, '')), pieces > 0 ? pieces : null, weight > 0 ? weight : null,
          clip(order.description, 500) || null, clip(order.trackingNumber || order.orderNumber, 80) || null,
          clip(dropoff.instructions, 1000) || null, order.id]);
      const { rows: [f] } = await db.query(`${SELECT} WHERE f.id = $1`, [row.id]);
      return res.status(201).json(serialize(f));
    } catch (e) {
      if (e.code === '23505' && /order/.test(e.constraint || '')) {
        const again = await db.query(`${SELECT} WHERE f.order_id = $1`, [order.id]);
        return res.json(serialize(again.rows[0]));
      }
      if (e.code === '23505' && attempt < 5) continue;
      throw e;
    }
  }
}));

router.get('/', requireRole('admin', 'dispatcher', 'shipper'), asyncH(async (req, res) => {
  const params = [];
  const { rows } = await db.query(`${SELECT} WHERE ${scope(req.user, params)} ORDER BY f.created_at DESC LIMIT 100`, params);
  res.json(rows.map(serialize));
}));

router.get('/:code', requireRole('admin', 'dispatcher', 'shipper'), asyncH(async (req, res) => {
  const params = [String(req.params.code).toUpperCase()];
  const { rows: [f] } = await db.query(`${SELECT} WHERE f.code = $1 AND ${scope(req.user, params)}`, params);
  if (!f) throw new HttpError(404, 'Shipping form not found');
  res.json(serialize(f));
}));

module.exports = router;
