const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, isStaff } = require('../auth');
const {
  ACTIVE, recordEvent, createOrder, visibilityFilter, ORDER_SELECT, serializeOrder, loadStops,
  getOrderFor, arriveAtStop, completeStop, nextStop, normalizeStops, insertStops,
} = require('../orders');
const { notifyDriversOfOrder, notifyUser } = require('../push');
const { asyncH, HttpError, str } = require('../util');
const { isServiceLevel, defaultPriceCents } = require('../pricing');

const router = express.Router();
router.use(requireAuth);

const driverOnly = (req, res, next) => {
  if (req.user.role !== 'driver') return next(new HttpError(403, 'Only drivers can do this'));
  next();
};

// GET /orders?status=pending&mine=true&organizationId=&limit=&before=
//   drivers:   unassigned pending jobs + their own
//   shippers:  their company's orders
//   staff:     everything
router.get('/', asyncH(async (req, res) => {
  const params = [];
  const where = [visibilityFilter(req.user, params)];
  if (req.query.status) {
    const statuses = String(req.query.status).toLowerCase().split(',');
    params.push(statuses);
    where.push(`o.status = ANY($${params.length})`);
  }
  if (req.query.mine === 'true' && req.user.role === 'driver') {
    params.push(req.user.id);
    where.push(`o.driver_id = $${params.length}`);
  }
  if (req.query.organizationId && isStaff(req.user)) {
    params.push(req.query.organizationId);
    where.push(`o.organization_id = $${params.length}`);
  }
  if (req.query.driverId && isStaff(req.user)) {
    params.push(req.query.driverId);
    where.push(`o.driver_id = $${params.length}`);
  }
  if (req.query.before) {
    params.push(req.query.before);
    where.push(`o.created_at < $${params.length}`);
  }
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || 100, 500);
  params.push(limit);
  const { rows } = await db.query(
    `${ORDER_SELECT} WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT $${params.length}`, params);
  const stops = await loadStops(db, rows.map((r) => r.id));
  res.json(rows.map((o) => serializeOrder(o, stops.get(o.id), { user: req.user })));
}));

router.post('/', requireRole('shipper', 'admin', 'dispatcher'), asyncH(async (req, res) => {
  const id = await db.withTx((client) => createOrder(client, req.user, req.body || {}));
  const order = await getOrderFor(req.user, id);
  notifyDriversOfOrder(order).catch((e) => console.error('Push notify failed:', e));
  res.status(201).json(order);
}));

// Driver barcode scan: completes the next pickup stop on the order with that tracking number.
router.post('/scan', driverOnly, asyncH(async (req, res) => {
  const barcode = str(req.body?.barcode);
  if (!barcode) throw new HttpError(400, 'barcode is required');
  const id = await db.withTx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET driver_id = $2, status = 'accepted', accepted_at = now(), updated_at = now()
       WHERE tracking_number = $1 AND status = 'pending' AND driver_id IS NULL RETURNING id`,
      [barcode, req.user.id]
    );
    if (rows[0]) await recordEvent(client, rows[0].id, req.user.id, 'accepted', { via: 'scan' });
    const { rows: found } = await client.query(
      'SELECT id FROM orders WHERE tracking_number = $1 AND driver_id = $2', [barcode, req.user.id]);
    if (!found[0]) throw new HttpError(404, 'No open shipment of yours matches that barcode');
    const orderId = found[0].id;
    const stop = nextStop((await loadStops(client, [orderId])).get(orderId));
    if (!stop || stop.type !== 'pickup') throw new HttpError(409, 'This shipment has already been picked up');
    await completeStop(client, req.user, orderId, stop.id, { barcode });
    return orderId;
  });
  res.json(await getOrderFor(req.user, id));
}));

router.get('/:id', asyncH(async (req, res) => {
  res.json(await getOrderFor(req.user, req.params.id));
}));

// Edit details. Staff: any time before completion. Shippers: only while still pending.
router.patch('/:id', requireRole('shipper', 'admin', 'dispatcher'), asyncH(async (req, res) => {
  const current = await getOrderFor(req.user, req.params.id);
  if (['completed', 'cancelled'].includes(current.status)) throw new HttpError(409, `Order is ${current.status}`);
  if (req.user.role === 'shipper' && current.status !== 'pending') {
    throw new HttpError(409, 'A driver has accepted this order; contact dispatch to change it');
  }
  const b = req.body || {};
  if (b.priceCents !== undefined && !isStaff(req.user)) throw new HttpError(403, 'Only dispatch can set a price');
  if (b.serviceLevel !== undefined && !isServiceLevel(b.serviceLevel)) {
    throw new HttpError(400, 'serviceLevel must be "standard" or "same_day"');
  }
  // A shipper switching service level gets that level's published price.
  if (b.serviceLevel !== undefined && b.priceCents === undefined && !isStaff(req.user)) {
    b.priceCents = defaultPriceCents(b.serviceLevel);
  }
  await db.withTx(async (client) => {
    try {
      await client.query(
        `UPDATE orders SET vehicle_type = COALESCE($2, vehicle_type), weight = COALESCE($3, weight),
           number_of_pieces = COALESCE($4, number_of_pieces), description = COALESCE($5, description),
           tracking_number = CASE WHEN $6::boolean THEN NULLIF($7, '') ELSE tracking_number END,
           price_cents = CASE WHEN $8::boolean THEN $9::int ELSE price_cents END,
           scheduled_at = CASE WHEN $10::boolean THEN $11::timestamptz ELSE scheduled_at END,
           service_level = COALESCE($12, service_level),
           updated_at = now()
         WHERE id = $1`,
        [current.id, b.vehicleType ?? null, b.weight ?? null, b.numberOfPieces ?? null, b.description ?? null,
          b.trackingNumber !== undefined, str(b.trackingNumber), b.priceCents !== undefined, b.priceCents ?? null,
          b.scheduledAt !== undefined, b.scheduledAt || null, b.serviceLevel ?? null]
      );
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'That tracking number is already in use');
      if (['22P02', '22007', '22008'].includes(e.code)) throw new HttpError(400, 'Invalid priceCents or scheduledAt');
      throw e;
    }
    // Stops can be replaced only before any of them has been started.
    if (b.stops !== undefined) {
      if (current.stops.some((s) => s.status !== 'pending')) throw new HttpError(409, 'Stops can no longer be changed');
      const stops = normalizeStops(b.stops);
      await client.query('DELETE FROM stops WHERE order_id = $1', [current.id]);
      await insertStops(client, current.id, stops);
    }
    await recordEvent(client, current.id, req.user.id, 'updated', { fields: Object.keys(b) });
  });
  res.json(await getOrderFor(req.user, current.id));
}));

router.post('/:id/cancel', requireRole('shipper', 'admin', 'dispatcher'), asyncH(async (req, res) => {
  const current = await getOrderFor(req.user, req.params.id);
  if (req.user.role === 'shipper' && current.status !== 'pending') {
    throw new HttpError(409, 'A driver has accepted this order; contact dispatch to cancel it');
  }
  const { rows } = await db.withTx(async (client) => {
    const r = await client.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now()
       WHERE id = $1 AND status NOT IN ('completed', 'cancelled') RETURNING driver_id`, [current.id]);
    if (r.rows[0]) await recordEvent(client, current.id, req.user.id, 'cancelled', { reason: str(req.body?.reason) || undefined });
    return r;
  });
  if (!rows[0]) throw new HttpError(409, `Order is ${current.status}`);
  if (rows[0].driver_id) {
    notifyUser(rows[0].driver_id, 'Order cancelled', `${current.orderNumber} was cancelled`, { orderId: current.id })
      .catch((e) => console.error('Push notify failed:', e));
  }
  res.json(await getOrderFor(req.user, current.id));
}));

// Dispatch assigns (or reassigns) a driver. driverId: null puts it back in the open pool.
router.post('/:id/assign', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const driverId = req.body?.driverId || null;
  await db.withTx(async (client) => {
    if (driverId) {
      const { rows } = await client.query(
        "SELECT id FROM users WHERE id = $1 AND role = 'driver' AND is_active", [driverId]).catch(() => ({ rows: [] }));
      if (!rows[0]) throw new HttpError(400, 'Driver not found');
    }
    const { rows } = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [req.params.id])
      .catch(() => ({ rows: [] }));
    if (!rows[0]) throw new HttpError(404, 'Order not found');
    if (!['pending', ...ACTIVE].includes(rows[0].status)) throw new HttpError(409, `Order is ${rows[0].status}`);
    if (!driverId && rows[0].status !== 'accepted' && rows[0].status !== 'pending') {
      throw new HttpError(409, 'This order is already underway; assign another driver instead');
    }
    await client.query(
      `UPDATE orders SET driver_id = $2,
         status = CASE WHEN $2::uuid IS NULL THEN 'pending' WHEN status = 'pending' THEN 'accepted' ELSE status END,
         accepted_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE COALESCE(accepted_at, now()) END,
         updated_at = now()
       WHERE id = $1`,
      [req.params.id, driverId]
    );
    await recordEvent(client, req.params.id, req.user.id, driverId ? 'assigned' : 'unassigned', { driverId });
  });
  if (driverId) {
    notifyUser(driverId, 'New job assigned', 'Dispatch assigned you a job', { orderId: req.params.id })
      .catch((e) => console.error('Push notify failed:', e));
  }
  res.json(await getOrderFor(req.user, req.params.id));
}));

// Driver claims an open job. Atomic, so two drivers can't accept the same order.
router.post('/:id/accept', driverOnly, asyncH(async (req, res) => {
  await db.withTx(async (client) => {
    const { rows } = await client.query(
      `UPDATE orders SET driver_id = $2, status = 'accepted', accepted_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'pending' AND driver_id IS NULL RETURNING id`,
      [req.params.id, req.user.id]
    ).catch(() => ({ rows: [] }));
    if (!rows[0]) throw new HttpError(409, 'This job is no longer available');
    await recordEvent(client, req.params.id, req.user.id, 'accepted');
  });
  res.json(await getOrderFor(req.user, req.params.id));
}));

router.post('/:id/stops/:stopId/arrive', driverOnly, asyncH(async (req, res) => {
  await db.withTx((client) => arriveAtStop(client, req.user, req.params.id, req.params.stopId));
  res.json(await getOrderFor(req.user, req.params.id));
}));

// Body: { signature?, photo?, printedName? } — at least one of signature/photo.
router.post('/:id/stops/:stopId/complete', driverOnly, asyncH(async (req, res) => {
  const { signature, photo, printedName } = req.body || {};
  await db.withTx((client) => completeStop(client, req.user, req.params.id, req.params.stopId,
    { signature, photo, printedName }));
  res.json(await getOrderFor(req.user, req.params.id));
}));

router.post('/:id/notes', asyncH(async (req, res) => {
  const note = str(req.body?.note);
  if (!note) throw new HttpError(400, 'note is required');
  const order = await getOrderFor(req.user, req.params.id);
  if (req.user.role === 'driver' && order.driver?.id !== req.user.id) {
    throw new HttpError(403, 'Accept this job before adding notes');
  }
  const entry = { note, authorId: req.user.id, authorRole: req.user.role, createdAt: new Date().toISOString() };
  await db.withTx(async (client) => {
    await client.query(
      "UPDATE orders SET notes = notes || $2::jsonb, updated_at = now() WHERE id = $1",
      [order.id, JSON.stringify([entry])]
    );
    await recordEvent(client, order.id, req.user.id, 'note_added');
  });
  res.json(await getOrderFor(req.user, order.id));
}));

module.exports = router;
