const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, isStaff } = require('../auth');
const {
  ACTIVE, recordEvent, createOrder, repriceOrder, visibilityFilter, ORDER_SELECT, serializeOrder, loadStops,
  getOrderFor, arriveAtStop, completeStop, nextStop, normalizeStops, insertStops,
} = require('../orders');
const { notifyDriversOfOrder, notifyUser } = require('../push');
const { asyncH, HttpError, str } = require('../util');
const stripe = require('../stripe');
const { isServiceLevel, normalizeServiceLevel } = require('../pricing');

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
  // Card orders notify drivers once paid (see the Stripe webhook).
  if (order.paymentStatus !== 'unpaid') notifyDriversOfOrder(order).catch((e) => console.error('Push notify failed:', e));
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
  if (req.user.role === 'shipper' && current.paymentStatus === 'paid'
    && (b.stops !== undefined || b.serviceLevel !== undefined || b.scheduledAt !== undefined)) {
    throw new HttpError(409, 'This order is already paid; contact dispatch to change the route, service or time');
  }
  if (b.serviceLevel !== undefined && !isServiceLevel(b.serviceLevel)) {
    throw new HttpError(400, 'serviceLevel must be "standard" or "rush"');
  }
  if (b.serviceLevel !== undefined) b.serviceLevel = normalizeServiceLevel(b.serviceLevel);
  await db.withTx(async (client) => {
    try {
      await client.query(
        `UPDATE orders SET vehicle_type = COALESCE($2, vehicle_type), weight = COALESCE($3, weight),
           number_of_pieces = COALESCE($4, number_of_pieces), description = COALESCE($5, description),
           tracking_number = CASE WHEN $6::boolean THEN NULLIF($7, '') ELSE tracking_number END,
           price_cents = CASE WHEN $8::boolean THEN $9::int ELSE price_cents END,
           -- Dispatch setting a price makes it custom; clearing it (null) goes back to the formula.
           price_is_custom = CASE WHEN $8::boolean THEN $9::int IS NOT NULL ELSE price_is_custom END,
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
    await repriceOrder(client, current.id);
    await recordEvent(client, current.id, req.user.id, 'updated', { fields: Object.keys(b) });
  });
  res.json(await getOrderFor(req.user, current.id));
}));

router.post('/:id/cancel', requireRole('shipper', 'admin', 'dispatcher'), asyncH(async (req, res) => {
  const current = await getOrderFor(req.user, req.params.id);
  if (req.user.role === 'shipper' && current.status !== 'pending') {
    throw new HttpError(409, 'A driver has accepted this order; contact dispatch to cancel it');
  }
  if (['completed', 'cancelled'].includes(current.status)) throw new HttpError(409, `Order is ${current.status}`);
  const { rows } = await db.withTx(async (client) => {
    const { rows: [o] } = await client.query(
      'SELECT payment_status, paid_cents, stripe_payment_intent, stripe_session_id FROM orders WHERE id = $1 FOR UPDATE',
      [current.id]);
    // Card payments are refunded in full; the refund happens before the order is cancelled.
    let refundedCents = null;
    if (o.payment_status === 'paid' && o.stripe_payment_intent) {
      try {
        const refund = await stripe.refund(o.stripe_payment_intent, o.paid_cents, current.id);
        refundedCents = refund.amount ?? o.paid_cents;
      } catch (e) {
        throw new HttpError(502, `The refund didn't go through, so the order was not cancelled: ${e.message}`);
      }
    } else if (o.payment_status === 'unpaid' && o.stripe_session_id) {
      await stripe.expireCheckoutSession(o.stripe_session_id).catch(() => {});
    }
    const r = await client.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now(),
         payment_status = CASE WHEN $2::int IS NOT NULL THEN 'refunded' ELSE payment_status END,
         refunded_cents = COALESCE($2, refunded_cents)
       WHERE id = $1 AND status NOT IN ('completed', 'cancelled') RETURNING driver_id`, [current.id, refundedCents]);
    if (r.rows[0]) {
      await recordEvent(client, current.id, req.user.id, 'cancelled', { reason: str(req.body?.reason) || undefined });
      if (refundedCents != null) await recordEvent(client, current.id, req.user.id, 'refunded', { cents: refundedCents });
    }
    return r;
  });
  if (!rows[0]) throw new HttpError(409, `Order is ${current.status}`);
  if (rows[0].driver_id) {
    notifyUser(rows[0].driver_id, 'Order cancelled', `${current.orderNumber} was cancelled`, { orderId: current.id })
      .catch((e) => console.error('Push notify failed:', e));
  }
  res.json(await getOrderFor(req.user, current.id));
}));

// Starts card payment: returns a Stripe Checkout URL for the order's current price.
router.post('/:id/checkout', requireRole('shipper', 'admin', 'dispatcher'), asyncH(async (req, res) => {
  if (!stripe.enabled()) throw new HttpError(503, 'Online payment is not set up yet');
  const order = await getOrderFor(req.user, req.params.id);
  if (order.paymentStatus !== 'unpaid') throw new HttpError(409, 'This order does not need payment');
  if (order.status === 'cancelled') throw new HttpError(409, 'Order is cancelled');
  if (!order.priceCents || order.priceCents < 50) throw new HttpError(409, 'This order has no price yet; contact dispatch');
  const { rows: [o] } = await db.query('SELECT stripe_session_id FROM orders WHERE id = $1', [order.id]);
  // Only one open payment link per order, so an old amount can't be paid after a change.
  if (o.stripe_session_id) await stripe.expireCheckoutSession(o.stripe_session_id).catch(() => {});
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const { rows: [me] } = req.user.id ? await db.query('SELECT email FROM users WHERE id = $1', [req.user.id]) : { rows: [{}] };
  const session = await stripe.createCheckoutSession({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amountCents: order.priceCents,
    description: `${order.stops[0]?.address} → ${order.stops[order.stops.length - 1]?.address}`,
    customerEmail: req.user.role === 'shipper' ? me?.email : undefined,
    successUrl: `${base}/#/orders/${order.id}?paid=1`,
    cancelUrl: `${base}/#/orders/${order.id}`,
  });
  await db.query('UPDATE orders SET stripe_session_id = $2, updated_at = now() WHERE id = $1', [order.id, session.id]);
  res.json({ url: session.url });
}));

// Dispatch records payment made another way (cash, check), waives it, or moves it to invoicing.
router.post('/:id/payment', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const { status, method } = req.body || {};
  if (!['paid', 'waived', 'invoice', 'unpaid'].includes(status)) {
    throw new HttpError(400, 'status must be paid, waived, invoice or unpaid');
  }
  const order = await getOrderFor(req.user, req.params.id);
  if (order.paymentStatus === 'paid' && order.paymentMethod === 'card' && status !== 'paid') {
    throw new HttpError(409, 'This order was paid by card; cancel it to refund instead');
  }
  await db.withTx(async (client) => {
    await client.query(
      `UPDATE orders SET payment_status = $2,
         paid_cents = CASE WHEN $2 = 'paid' THEN price_cents ELSE NULL END,
         paid_at = CASE WHEN $2 = 'paid' THEN now() ELSE NULL END,
         payment_method = CASE WHEN $2 = 'paid' THEN $3 ELSE NULL END,
         updated_at = now()
       WHERE id = $1`,
      [order.id, status, str(method) || 'cash']);
    await recordEvent(client, order.id, req.user.id, 'payment_updated', { status, method: str(method) || undefined });
  });
  const updated = await getOrderFor(req.user, order.id);
  if (order.paymentStatus === 'unpaid' && status !== 'unpaid' && updated.status === 'pending') {
    notifyDriversOfOrder(updated).catch((e) => console.error('Push notify failed:', e));
  }
  res.json(updated);
}));

// Dispatch assigns (or reassigns) a driver. driverId: null puts it back in the open pool.
router.post('/:id/assign', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const driverId = req.body?.driverId || null;
  await db.withTx(async (client) => {
    let driverIsDemo = null;
    if (driverId) {
      const { rows } = await client.query(
        "SELECT id, is_demo FROM users WHERE id = $1 AND role = 'driver' AND is_active", [driverId]).catch(() => ({ rows: [] }));
      if (!rows[0]) throw new HttpError(400, 'Driver not found');
      driverIsDemo = rows[0].is_demo;
    }
    const { rows } = await client.query('SELECT status, is_demo FROM orders WHERE id = $1 FOR UPDATE', [req.params.id])
      .catch(() => ({ rows: [] }));
    if (!rows[0]) throw new HttpError(404, 'Order not found');
    if (driverIsDemo !== null && driverIsDemo !== rows[0].is_demo) {
      throw new HttpError(400, rows[0].is_demo ? 'Demo orders can only go to demo drivers' : 'Demo drivers cannot take real orders');
    }
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
       WHERE id = $1 AND status = 'pending' AND driver_id IS NULL AND NOT is_demo AND payment_status <> 'unpaid'
       RETURNING id`,
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
