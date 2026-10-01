const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, isStaff } = require('../auth');
const {
  ACTIVE, recordEvent, createOrder, bookQuote, normalizeAddOns, parsePieceLbs, assertPieceWeights, repriceOrder, visibilityFilter, ORDER_SELECT, serializeOrder, loadStops,
  getOrderFor, arriveAtStop, completeStop, nextStop, normalizeStops, locateStops, insertStops, refreshDriverPay,
} = require('../orders');
const { notifyDriversOfOrder, notifyUser } = require('../push');
const { asyncH, HttpError, str } = require('../util');
const stripe = require('../stripe');
const { emailShipper } = require('../notify');
const { sendMail } = require('../mailer');
const { getUser, driverWorkBlocker } = require('../users');
const { isServiceLevel, normalizeServiceLevel, getFees, waitCharge, CHARGE_KINDS } = require('../pricing');

const router = express.Router();
const money = (c) => `$${(c / 100).toFixed(2)}`;
router.use(requireAuth);

// Tells dispatch (LEADS_EMAIL) that an order is waiting for a manual price.
function notifyStaffOfReview(order) {
  const base = process.env.PUBLIC_URL || 'https://app.choicedeliverysc.com';
  const reasons = order.priceBreakdown?.reviewReasons || [];
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  sendMail({
    to: process.env.LEADS_EMAIL || 'info@choicedeliverysc.com',
    subject: `Price review needed: ${order.orderNumber}${order.organization ? ` (${order.organization.name})` : ''}`,
    html: `<p><strong>${esc(order.orderNumber)}</strong> needs a price: ${esc(reasons.join('; '))}.</p>
      <p>${esc(order.vehicleType)} · ${esc(order.weight)} · ${esc(order.stops[0]?.address)} &rarr; ${esc(order.stops[order.stops.length - 1]?.address)}</p>
      <p><a href="${base}/#/orders/${order.id}">Open the order and set the price</a></p>`,
  }).catch((e) => console.error('Review email failed:', e.message));
}

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
  if (order.reviewStatus === 'needed') {
    emailShipper(order.id, 'review_requested');
    notifyStaffOfReview(order);
    return res.status(201).json(order);
  }
  if (order.status === 'quote' && req.body?.saveAsQuote !== true) {
    return res.status(409).json({
      message: `The price is now ${money(order.priceCents)} (you were shown ${money(Number(req.body.expectedCents))}). `
        + "We saved it as a quote; review it and book when you're ready.",
      priceChanged: true, order,
    });
  }
  if (order.status === 'quote') {
    emailShipper(order.id, 'quote_saved');
    return res.status(201).json(order);
  }
  // Card orders notify drivers once paid (see the Stripe webhook).
  if (order.paymentStatus !== 'unpaid') notifyDriversOfOrder(order).catch((e) => console.error('Push notify failed:', e));
  emailShipper(order.id, 'booked');
  res.status(201).json(order);
}));

// Books a saved quote. Body: { expectedCents } = the price the customer was shown. If the price has
// changed since (time of day, demand, weather), the quote is updated and 409 is returned instead.
router.post('/:id/book', requireRole('shipper', 'admin', 'dispatcher'), asyncH(async (req, res) => {
  const current = await getOrderFor(req.user, req.params.id);
  if (current.status !== 'quote') throw new HttpError(409, 'This order is already booked');
  const expectedCents = req.body?.expectedCents;
  const result = await db.withTx((client) => bookQuote(client, req.user, current.id, { expectedCents }));
  const order = await getOrderFor(req.user, current.id);
  if (!result.booked) {
    return res.status(409).json({
      message: `The price is now ${money(result.priceCents)} (it was ${money(expectedCents)}) because of the time of day, demand or weather. Review it and book again.`,
      priceChanged: true, order,
    });
  }
  if (order.paymentStatus !== 'unpaid') notifyDriversOfOrder(order).catch((e) => console.error('Push notify failed:', e));
  emailShipper(order.id, 'booked');
  res.json(order);
}));

// Deletes a saved quote (booked orders are cancelled instead, so their history is kept).
router.delete('/:id', requireRole('shipper', 'admin', 'dispatcher'), asyncH(async (req, res) => {
  const current = await getOrderFor(req.user, req.params.id);
  if (current.status !== 'quote') throw new HttpError(409, 'Only saved quotes can be deleted; cancel the order instead');
  await db.query("DELETE FROM orders WHERE id = $1 AND status = 'quote'", [current.id]);
  res.status(204).end();
}));

// Optional barcode check for shipments that have one (not every shipper uses a BOL or labels). Finds the
// driver's job, or an open job, with that reference number. On the driver's own job it records the barcode
// on the next pickup as extra proof. It never accepts a job or completes a pickup: the driver still does
// that with a signature or photo.
router.post('/scan', driverOnly, asyncH(async (req, res) => {
  const barcode = str(req.body?.barcode);
  if (!barcode) throw new HttpError(400, 'barcode is required');
  const params = [barcode];
  const where = visibilityFilter(req.user, params);
  const { rows } = await db.query(
    `SELECT o.id, o.driver_id FROM orders o WHERE o.tracking_number = $1 AND o.status <> 'cancelled' AND ${where}`, params);
  if (!rows[0]) throw new HttpError(404, 'No job of yours or open job matches that barcode');
  const { id } = rows[0];
  let matchedStop = null;
  if (rows[0].driver_id === req.user.id) {
    await db.withTx(async (client) => {
      const stop = nextStop((await loadStops(client, [id])).get(id));
      if (stop && stop.type === 'pickup') {
        await client.query('UPDATE stops SET barcode = $2 WHERE id = $1', [stop.id, barcode]);
        await recordEvent(client, id, req.user.id, 'barcode_scanned', { stopId: stop.id, barcode });
        matchedStop = stop.id;
      }
    });
  }
  res.json({ ...(await getOrderFor(req.user, id)), scan: { barcode, stopId: matchedStop } });
}));

router.get('/:id', asyncH(async (req, res) => {
  res.json(await getOrderFor(req.user, req.params.id));
}));

// Edit details. Staff: any time before completion. Shippers: only while still pending.
router.patch('/:id', requireRole('shipper', 'admin', 'dispatcher'), asyncH(async (req, res) => {
  const current = await getOrderFor(req.user, req.params.id);
  if (['completed', 'cancelled'].includes(current.status)) throw new HttpError(409, `Order is ${current.status}`);
  if (req.user.role === 'shipper' && !['quote', 'pending'].includes(current.status)) {
    throw new HttpError(409, 'A driver has accepted this order; contact dispatch to change it');
  }
  const b = req.body || {};
  if (b.priceCents !== undefined && !isStaff(req.user)) throw new HttpError(403, 'Only dispatch can set a price');
  if (req.user.role === 'shipper' && current.paymentStatus === 'paid'
    && ['stops', 'serviceLevel', 'scheduledAt', 'weight', 'addOns', 'maxPieceLbs', 'numberOfPieces'].some((k) => b[k] !== undefined)) {
    throw new HttpError(409, 'This order is already paid; contact dispatch to change the route, service, time, weight or add-ons');
  }
  const addOns = b.addOns === undefined ? undefined : normalizeAddOns(b.addOns);
  const maxPieceLbs = b.maxPieceLbs === undefined ? undefined : parsePieceLbs(b.maxPieceLbs);
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
           add_ons = CASE WHEN $13::boolean THEN $14::text[] ELSE add_ons END,
           max_piece_lbs = CASE WHEN $15::boolean THEN $16::numeric ELSE max_piece_lbs END,
           updated_at = now()
         WHERE id = $1`,
        [current.id, b.vehicleType ?? null, b.weight ?? null, b.numberOfPieces ?? null, b.description ?? null,
          b.trackingNumber !== undefined, str(b.trackingNumber), b.priceCents !== undefined, b.priceCents ?? null,
          b.scheduledAt !== undefined, b.scheduledAt || null, b.serviceLevel ?? null, addOns !== undefined, addOns || [], maxPieceLbs !== undefined, maxPieceLbs ?? null]
      );
    } catch (e) {
      if (e.code === '23505') throw new HttpError(409, 'That tracking number is already in use');
      if (['22P02', '22007', '22008'].includes(e.code)) throw new HttpError(400, 'Invalid priceCents or scheduledAt');
      throw e;
    }
    if (['weight', 'numberOfPieces', 'maxPieceLbs'].some((k) => b[k] !== undefined)) await assertPieceWeights(client, current.id);
    // Stops can be replaced only before any of them has been started.
    if (b.stops !== undefined) {
      if (current.stops.some((s) => s.status !== 'pending')) throw new HttpError(409, 'Stops can no longer be changed');
      const stops = await locateStops(normalizeStops(b.stops));
      await client.query('DELETE FROM stops WHERE order_id = $1', [current.id]);
      await insertStops(client, current.id, stops);
    }
    await repriceOrder(client, current.id);
    await recordEvent(client, current.id, req.user.id, 'updated', { fields: Object.keys(b) });
    // A quote edited so the formula can (or can no longer) price it moves in or out of review.
    await client.query(
      `UPDATE orders SET review_status = CASE WHEN price_is_custom THEN review_status
         WHEN (price_breakdown->>'needsReview')::boolean THEN 'needed' ELSE NULL END
       WHERE id = $1 AND status = 'quote'`, [current.id]);
    // Dispatch pricing an order that was waiting for review releases it to the customer.
    if (current.reviewStatus === 'needed' && b.priceCents != null && isStaff(req.user)) {
      await client.query("UPDATE orders SET review_status = 'done' WHERE id = $1", [current.id]);
      await recordEvent(client, current.id, req.user.id, 'price_set', { cents: Number(b.priceCents) });
    }
  });
  const updated = await getOrderFor(req.user, current.id);
  if (current.reviewStatus === 'needed' && updated.reviewStatus === 'done') emailShipper(updated.id, 'price_ready');
  res.json(updated);
}));

router.post('/:id/cancel', requireRole('shipper', 'admin', 'dispatcher'), asyncH(async (req, res) => {
  const current = await getOrderFor(req.user, req.params.id);
  if (current.status === 'quote') throw new HttpError(409, 'This is a saved quote; delete it instead');
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
  if (req.user.role !== 'shipper') emailShipper(current.id, 'cancelled');
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
  if (order.status === 'quote') throw new HttpError(409, 'Book this quote first');
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const { rows: [me] } = req.user.id ? await db.query('SELECT email FROM users WHERE id = $1', [req.user.id]) : { rows: [{}] };
  const customerEmail = req.user.role === 'shipper' ? me?.email : undefined;
  // Additional charges (wait time, etc.) on an order that's already paid are paid separately.
  if (order.paymentStatus !== 'unpaid' && order.balanceDueCents > 0) {
    const due = order.charges.filter((c) => c.status === 'due');
    const { rows: open } = await db.query(
      "SELECT DISTINCT stripe_session_id FROM order_charges WHERE order_id = $1 AND status = 'due' AND stripe_session_id IS NOT NULL",
      [order.id]);
    for (const o of open) await stripe.expireCheckoutSession(o.stripe_session_id).catch(() => {});
    const session = await stripe.createCheckoutSession({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amountCents: order.balanceDueCents,
      name: `Additional charges for ${order.orderNumber}`,
      description: due.map((c) => `${CHARGE_KINDS[c.kind]}${c.description ? `: ${c.description}` : ''}`).join('; ').slice(0, 450),
      metadata: { kind: 'charges' },
      customerEmail,
      successUrl: `${base}/#/orders/${order.id}?paid=1`,
      cancelUrl: `${base}/#/orders/${order.id}`,
    });
    await db.query("UPDATE order_charges SET stripe_session_id = $2 WHERE order_id = $1 AND status = 'due' AND id = ANY($3)",
      [order.id, session.id, due.map((c) => c.id)]);
    return res.json({ url: session.url });
  }
  if (order.paymentStatus !== 'unpaid') throw new HttpError(409, 'This order does not need payment');
  if (order.status === 'cancelled') throw new HttpError(409, 'Order is cancelled');
  if (!order.priceCents || order.priceCents < 50) throw new HttpError(409, 'This order has no price yet; contact dispatch');
  const { rows: [o] } = await db.query('SELECT stripe_session_id FROM orders WHERE id = $1', [order.id]);
  // Only one open payment link per order, so an old amount can't be paid after a change.
  if (o.stripe_session_id) await stripe.expireCheckoutSession(o.stripe_session_id).catch(() => {});
  const session = await stripe.createCheckoutSession({
    orderId: order.id,
    orderNumber: order.orderNumber,
    amountCents: order.priceCents,
    description: `${order.stops[0]?.address} → ${order.stops[order.stops.length - 1]?.address}`,
    customerEmail,
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
  if (order.status === 'quote') throw new HttpError(409, 'Book this quote first');
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

// Dispatch adds a charge after booking (wait time, heavier than declared, return trip...). The customer is
// emailed the reason and amount; card customers pay it online, monthly accounts are billed.
// Body: { kind, cents?, minutes?, stopId?, description? }. Wait time without cents is priced by the fee
// settings (free minutes, then per block).
router.post('/:id/charges', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const b = req.body || {};
  if (!CHARGE_KINDS[b.kind]) throw new HttpError(400, `kind must be one of: ${Object.keys(CHARGE_KINDS).join(', ')}`);
  const order = await getOrderFor(req.user, req.params.id);
  if (['quote', 'cancelled'].includes(order.status)) throw new HttpError(409, `Order is ${order.status === 'quote' ? 'a quote' : 'cancelled'}`);
  const minutes = b.minutes == null || b.minutes === '' ? null : Math.round(Number(b.minutes));
  if (minutes != null && (!Number.isFinite(minutes) || minutes < 0)) throw new HttpError(400, 'minutes must be a positive number');
  let cents = b.cents == null || b.cents === '' ? null : Math.round(Number(b.cents));
  if (cents == null && b.kind === 'wait_time' && minutes != null) cents = waitCharge(minutes, await getFees(db)).cents;
  if (!Number.isFinite(cents) || cents <= 0) {
    throw new HttpError(400, b.kind === 'wait_time' && minutes != null
      ? 'That wait is within the free time, so there is nothing to charge' : 'Enter an amount');
  }
  const stopId = b.stopId && order.stops.some((st) => st.id === b.stopId) ? b.stopId : null;
  // Card customers pay extra charges online; everyone else is billed to their account.
  const byCard = order.paymentMethod === 'card' || order.paymentStatus === 'unpaid';
  await db.withTx(async (client) => {
    const { rows: [c] } = await client.query(
      `INSERT INTO order_charges (order_id, kind, description, cents, minutes, stop_id, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [order.id, b.kind, str(b.description).slice(0, 300), cents, minutes, stopId, byCard ? 'due' : 'invoice', req.user.id]);
    await recordEvent(client, order.id, req.user.id, 'charge_added', { chargeId: c.id, kind: b.kind, cents, minutes });
    await client.query('UPDATE orders SET updated_at = now() WHERE id = $1', [order.id]);
    await refreshDriverPay(client, order.id);
  });
  const updated = await getOrderFor(req.user, order.id);
  emailShipper(order.id, 'charge_added', { charge: updated.charges[updated.charges.length - 1] });
  res.status(201).json(updated);
}));

// Dispatch sets what the driver earns for this order. Body: { cents } (null goes back to the
// owner's driver-pay rate). Works until the pay has been paid out, including on completed orders.
router.put('/:id/driver-pay', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const order = await getOrderFor(req.user, req.params.id);
  if (order.driverPaidAt) throw new HttpError(409, 'This pay was already paid out');
  const raw = req.body?.cents;
  const cents = raw === null || raw === '' || raw === undefined ? null : Math.round(Number(raw));
  if (cents != null && (!Number.isFinite(cents) || cents < 0 || cents > 1000000)) throw new HttpError(400, 'Enter a valid amount');
  await db.withTx(async (client) => {
    await client.query('UPDATE orders SET driver_pay_is_custom = $2, driver_pay_cents = COALESCE($3, driver_pay_cents), updated_at = now() WHERE id = $1',
      [order.id, cents != null, cents]);
    await refreshDriverPay(client, order.id);
    await recordEvent(client, order.id, req.user.id, 'driver_pay_set', { cents });
  });
  res.json(await getOrderFor(req.user, order.id));
}));

// Dispatch removes a charge that hasn't been paid (kept on record as waived).
router.post('/:id/charges/:chargeId/waive', requireRole('admin', 'dispatcher'), asyncH(async (req, res) => {
  const order = await getOrderFor(req.user, req.params.id);
  const charge = (order.charges || []).find((c) => c.id === req.params.chargeId);
  if (!charge) throw new HttpError(404, 'Charge not found');
  if (charge.status === 'paid') throw new HttpError(409, 'This charge was already paid');
  await db.withTx(async (client) => {
    await client.query("UPDATE order_charges SET status = 'waived' WHERE id = $1", [charge.id]);
    await recordEvent(client, order.id, req.user.id, 'charge_waived', { chargeId: charge.id, cents: charge.cents });
    await client.query('UPDATE orders SET updated_at = now() WHERE id = $1', [order.id]);
    await refreshDriverPay(client, order.id);
  });
  res.json(await getOrderFor(req.user, order.id));
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
      const blocker = rows[0].is_demo ? null : driverWorkBlocker(await getUser(driverId, client));
      if (blocker) throw new HttpError(400, `That driver can't take jobs right now: ${blocker}`);
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
    emailShipper(req.params.id, 'driver_assigned');
  }
  res.json(await getOrderFor(req.user, req.params.id));
}));

// Driver claims an open job. Atomic, so two drivers can't accept the same order.
router.post('/:id/accept', driverOnly, asyncH(async (req, res) => {
  const blocker = driverWorkBlocker(await getUser(req.user.id));
  if (blocker) throw new HttpError(409, blocker);
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
  emailShipper(req.params.id, 'driver_assigned');
  res.json(await getOrderFor(req.user, req.params.id));
}));

router.post('/:id/stops/:stopId/arrive', driverOnly, asyncH(async (req, res) => {
  await db.withTx((client) => arriveAtStop(client, req.user, req.params.id, req.params.stopId,
    { location: req.body?.location }));
  res.json(await getOrderFor(req.user, req.params.id));
}));

// Arrive and complete both take { location: { lat, lng, accuracy?, mocked? } } from the phone; the driver
// must be near the stop's address. Complete body: { signature?, photo?, printedName?, location }:
// drop-offs need a photo and a signature, pickups at least one of them.
router.post('/:id/stops/:stopId/complete', driverOnly, asyncH(async (req, res) => {
  const { signature, photo, printedName, location } = req.body || {};
  await db.withTx((client) => completeStop(client, req.user, req.params.id, req.params.stopId,
    { signature, photo, printedName, location }));
  const updated = await getOrderFor(req.user, req.params.id);
  const stop = updated.stops.find((s) => s.id === req.params.stopId);
  if (updated.status === 'completed') emailShipper(updated.id, 'delivered', { printedName: str(printedName) });
  else if (stop?.type === 'pickup' && updated.status === 'in_transit') emailShipper(updated.id, 'picked_up');
  res.json(updated);
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
