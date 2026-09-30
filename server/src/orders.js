// Order domain logic shared by the routes and import scripts.
const db = require('./db');
const { HttpError, parseLocation, str } = require('./util');
const { isStaff } = require('./auth');
const stripe = require('./stripe');
const { isServiceLevel, normalizeServiceLevel, calculatePrice, routeMiles, pricingContext } = require('./pricing');

const ACTIVE = ['accepted', 'at_pickup', 'in_transit', 'at_dropoff'];

async function recordEvent(client, orderId, actorId, type, data = {}) {
  await client.query(
    'INSERT INTO order_events (order_id, actor_id, type, data) VALUES ($1, $2, $3, $4)',
    [orderId, actorId, type, JSON.stringify(data)]
  );
}

function normalizeStops(stops) {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new HttpError(400, 'An order needs a stops array with at least one pickup and one dropoff');
  }
  const out = stops.map((s, i) => {
    if (!s || !['pickup', 'dropoff'].includes(s.type)) {
      throw new HttpError(400, `stops[${i}].type must be "pickup" or "dropoff"`);
    }
    if (!str(s.address)) throw new HttpError(400, `stops[${i}].address is required`);
    return {
      type: s.type,
      address: str(s.address),
      location: parseLocation(s.location),
      contactName: str(s.contactName),
      contactPhone: str(s.contactPhone),
      instructions: str(s.instructions),
    };
  });
  if (out[0].type !== 'pickup') throw new HttpError(400, 'The first stop must be a pickup');
  if (out[out.length - 1].type !== 'dropoff') throw new HttpError(400, 'The last stop must be a dropoff');
  return out;
}

async function insertStops(client, orderId, stops) {
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    await client.query(
      `INSERT INTO stops (order_id, sequence, type, address, location, contact_name, contact_phone, instructions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [orderId, i + 1, s.type, s.address, s.location && JSON.stringify(s.location),
        s.contactName, s.contactPhone, s.instructions]
    );
  }
}

// body.saveAsQuote: save the order as a quote to book (and pay) later instead of booking it now.
async function createOrder(client, actor, body) {
  const stops = normalizeStops(body.stops);
  const isQuote = body.saveAsQuote === true;
  let organizationId = body.organizationId || null;
  if (actor.role === 'shipper') organizationId = actor.organization_id;

  const serviceLevel = normalizeServiceLevel(body.serviceLevel === undefined ? 'standard' : body.serviceLevel);
  if (!isServiceLevel(serviceLevel)) throw new HttpError(400, 'serviceLevel must be "standard" or "rush"');
  // Priced by the distance formula (see repriceOrder) unless dispatch sets a custom price.
  let priceCents = null;
  if (body.priceCents != null) {
    if (!isStaff(actor)) throw new HttpError(403, 'Only dispatch can set a price');
    priceCents = Number.parseInt(body.priceCents, 10);
    if (!Number.isFinite(priceCents) || priceCents < 0) throw new HttpError(400, 'priceCents must be a positive integer');
  }

  const paymentStatus = await paymentStatusFor(client, actor.role, organizationId);

  let rows;
  try {
    ({ rows } = await client.query(
      `INSERT INTO orders (organization_id, created_by, vehicle_type, weight, number_of_pieces, description,
                           tracking_number, price_cents, price_is_custom, scheduled_at, service_level, payment_status,
                           status, booked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $13 = 'quote' THEN NULL ELSE now() END)
       RETURNING id`,
      [organizationId, actor.id, str(body.vehicleType), str(body.weight), str(body.numberOfPieces),
        str(body.description), str(body.trackingNumber) || null, priceCents, priceCents != null,
        body.scheduledAt || null, serviceLevel, paymentStatus, isQuote ? 'quote' : 'pending']
    ));
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'That tracking number is already in use');
    if (e.code === '23503') throw new HttpError(400, 'Organization not found');
    if (e.code === '22007' || e.code === '22008') throw new HttpError(400, 'scheduledAt must be a date/time');
    throw e;
  }
  const orderId = rows[0].id;
  await insertStops(client, orderId, stops);
  await repriceOrder(client, orderId, { fresh: true });
  await recordEvent(client, orderId, actor.id, isQuote ? 'quoted' : 'created');
  return orderId;
}

// Who pays how: dispatch-created orders and "invoice" companies are billed outside the app;
// card customers pay through Stripe before drivers see the job (when Stripe is set up).
async function paymentStatusFor(client, creatorRole, organizationId) {
  if (creatorRole !== 'shipper' || !stripe.enabled()) return 'invoice';
  const { rows: [org] } = await client.query('SELECT billing_mode FROM organizations WHERE id = $1', [organizationId]);
  return org?.billing_mode === 'invoice' ? 'invoice' : 'unpaid';
}

// Books a saved quote. It's re-priced for the actual booking (time of day, weekend, demand, weather)
// and a pickup time that has already passed becomes "as soon as possible". If the caller passes the
// price they were shown (expectedCents) and it changed, the quote is updated but NOT booked, so nobody
// is charged an amount they didn't see. Returns { booked, priceCents }.
async function bookQuote(client, actor, orderId, { expectedCents } = {}) {
  const { rows: [o] } = await client.query(
    `SELECT o.status, o.organization_id, o.scheduled_at, o.price_cents, u.role AS creator_role
     FROM orders o LEFT JOIN users u ON u.id = o.created_by WHERE o.id = $1 FOR UPDATE OF o`, [orderId]);
  if (!o) throw new HttpError(404, 'Order not found');
  if (o.status !== 'quote') throw new HttpError(409, 'This order is already booked');
  if (o.scheduled_at && new Date(o.scheduled_at) < new Date()) {
    await client.query('UPDATE orders SET scheduled_at = NULL WHERE id = $1', [orderId]);
  }
  await repriceOrder(client, orderId, { fresh: true, at: new Date() });
  const { rows: [priced] } = await client.query('SELECT price_cents FROM orders WHERE id = $1', [orderId]);
  if (expectedCents != null && Number(expectedCents) !== priced.price_cents) {
    await client.query('UPDATE orders SET updated_at = now() WHERE id = $1', [orderId]);
    await recordEvent(client, orderId, actor.id, 'repriced', { fromCents: o.price_cents, toCents: priced.price_cents });
    return { booked: false, priceCents: priced.price_cents };
  }
  // The creator's role decides billing: a quote dispatch prepared for a company is billed to account.
  const paymentStatus = await paymentStatusFor(client, o.creator_role, o.organization_id);
  await client.query(
    `UPDATE orders SET status = 'pending', booked_at = now(), payment_status = $2, updated_at = now() WHERE id = $1`,
    [orderId, paymentStatus]);
  await recordEvent(client, orderId, actor.id, 'created', { fromQuote: true });
  return { booked: true, priceCents: priced.price_cents };
}

// Recomputes distance and the formula price from the order's stops, service level and pickup time.
// Demand and weather surcharges are captured when the order is booked (fresh) and kept on later
// edits, so changing a detail doesn't surprise the customer with a new busy-time fee.
// A custom price set by dispatch is kept; the breakdown is still updated for reference.
// Unscheduled (ASAP) orders are priced for when they were booked; unbooked quotes for now.
async function repriceOrder(client, orderId, { fresh = false, at } = {}) {
  const { rows: [o] } = await client.query(
    'SELECT status, service_level, scheduled_at, booked_at, created_at, price_breakdown FROM orders WHERE id = $1', [orderId]);
  const { rows: stops } = await client.query(
    'SELECT location FROM stops WHERE order_id = $1 ORDER BY sequence', [orderId]);
  const previous = o.price_breakdown?.context;
  const context = fresh || !previous ? await pricingContext(client, orderId) : previous;
  const breakdown = calculatePrice({
    distanceMiles: routeMiles(stops.map((s) => s.location)),
    serviceLevel: o.service_level,
    at: o.scheduled_at || at || (o.status === 'quote' ? new Date() : o.booked_at || o.created_at),
    openOrders: context.openOrders,
    badWeather: context.badWeather,
  });
  await client.query(
    `UPDATE orders SET distance_miles = $2, price_breakdown = $3,
       price_cents = CASE WHEN price_is_custom THEN price_cents ELSE $4 END WHERE id = $1`,
    [orderId, breakdown.distanceMiles, JSON.stringify(breakdown), breakdown.totalCents]
  );
}

// SQL fragment + params limiting which orders a user can see.
function visibilityFilter(user, params) {
  if (isStaff(user)) return 'TRUE';
  if (user.role === 'shipper') {
    params.push(user.organization_id);
    return `o.organization_id = $${params.length}`;
  }
  params.push(user.id);
  // Drivers never see sample (demo) orders.
  // Unpaid card orders stay hidden until payment clears.
  return `NOT o.is_demo AND (o.driver_id = $${params.length}
    OR (o.status = 'pending' AND o.driver_id IS NULL AND o.payment_status <> 'unpaid'))`;
}

const ORDER_SELECT = `
  SELECT o.*, org.name AS organization_name,
         d.name AS driver_name, d.phone_number AS driver_phone,
         d.last_location AS driver_location, d.location_updated_at AS driver_location_updated_at
  FROM orders o
  LEFT JOIN organizations org ON org.id = o.organization_id
  LEFT JOIN users d ON d.id = o.driver_id`;

function serializeStop(s, { proof }) {
  const out = {
    id: s.id,
    sequence: s.sequence,
    type: s.type,
    status: s.status,
    address: s.address,
    location: s.location,
    contactName: s.contact_name,
    contactPhone: s.contact_phone,
    instructions: s.instructions,
    arrivedAt: s.arrived_at,
    completedAt: s.completed_at,
    printedName: s.printed_name,
    hasSignature: !!s.signature,
    hasPhoto: !!s.photo,
  };
  if (proof) Object.assign(out, { signature: s.signature, photo: s.photo, barcode: s.barcode });
  return out;
}

function serializeOrder(o, stops, { events, proof = false, user } = {}) {
  const showDriverLocation = ACTIVE.includes(o.status) && user && user.role !== 'driver';
  const out = {
    id: o.id,
    orderNumber: o.order_number,
    isDemo: o.is_demo,
    status: o.status,
    organization: o.organization_id ? { id: o.organization_id, name: o.organization_name } : null,
    driver: o.driver_id ? {
      id: o.driver_id,
      name: o.driver_name,
      phoneNumber: o.driver_phone,
      ...(showDriverLocation ? { location: o.driver_location, locationUpdatedAt: o.driver_location_updated_at } : {}),
    } : null,
    serviceLevel: o.service_level,
    isQuote: o.status === 'quote',
    distanceMiles: o.distance_miles == null ? null : Number(o.distance_miles),
    priceBreakdown: o.price_breakdown,
    priceIsCustom: o.price_is_custom,
    paymentStatus: o.payment_status,
    paidCents: o.paid_cents,
    paidAt: o.paid_at,
    paymentMethod: o.payment_method,
    refundedCents: o.refunded_cents,
    vehicleType: o.vehicle_type,
    weight: o.weight,
    numberOfPieces: o.number_of_pieces,
    description: o.description,
    trackingNumber: o.tracking_number,
    priceCents: o.price_cents,
    currency: o.currency,
    scheduledAt: o.scheduled_at,
    acceptedAt: o.accepted_at,
    completedAt: o.completed_at,
    cancelledAt: o.cancelled_at,
    createdAt: o.created_at,
    bookedAt: o.booked_at || (o.status === 'quote' ? null : o.created_at),
    updatedAt: o.updated_at,
    notes: o.notes,
    stops: stops.map((s) => serializeStop(s, { proof })),
  };
  // Quotes aren't trackable until they're booked.
  if (user && (isStaff(user) || user.role === 'shipper') && o.status !== 'quote') out.trackingUrlToken = o.public_token;
  if (events) out.events = events.map((e) => ({ type: e.type, data: e.data, actorId: e.actor_id, at: e.created_at }));
  return out;
}

async function loadStops(client, orderIds) {
  if (!orderIds.length) return new Map();
  const { rows } = await client.query(
    'SELECT * FROM stops WHERE order_id = ANY($1) ORDER BY order_id, sequence', [orderIds]);
  const map = new Map(orderIds.map((id) => [id, []]));
  for (const s of rows) map.get(s.order_id).push(s);
  return map;
}

// Loads one order the user may see (with stops + timeline), or throws 404.
async function getOrderFor(user, id, client = db) {
  const params = [id];
  const where = visibilityFilter(user, params);
  let rows;
  try {
    ({ rows } = await client.query(`${ORDER_SELECT} WHERE o.id = $1 AND ${where}`, params));
  } catch (e) {
    if (e.code === '22P02') throw new HttpError(404, 'Order not found');
    throw e;
  }
  if (!rows[0]) throw new HttpError(404, 'Order not found');
  const stops = (await loadStops(client, [id])).get(id);
  const { rows: events } = await client.query(
    'SELECT * FROM order_events WHERE order_id = $1 ORDER BY created_at, id', [id]);
  return serializeOrder(rows[0], stops, { events, proof: true, user });
}

// Recomputes the order's status from its stops after a stop changes.
function deriveStatus(stops) {
  if (stops.every((s) => s.status === 'completed')) return 'completed';
  const current = stops.find((s) => s.status !== 'completed');
  if (current.status === 'arrived') return current.type === 'pickup' ? 'at_pickup' : 'at_dropoff';
  if (stops.some((s) => s.type === 'pickup' && s.status === 'completed')) return 'in_transit';
  return 'accepted';
}

// Locks an order assigned to this driver for a stop update. Returns {order, stops}.
async function lockDriverOrder(client, driverId, orderId) {
  const { rows } = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  const order = rows[0];
  if (!order || order.driver_id !== driverId) throw new HttpError(404, 'Order not found or not assigned to you');
  if (!ACTIVE.includes(order.status)) throw new HttpError(409, `Order is ${order.status}`);
  const { rows: stops } = await client.query(
    'SELECT * FROM stops WHERE order_id = $1 ORDER BY sequence', [orderId]);
  return { order, stops };
}

async function applyDerivedStatus(client, order, stops) {
  const status = deriveStatus(stops);
  if (status !== order.status) {
    await client.query(
      `UPDATE orders SET status = $2, completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
         updated_at = now() WHERE id = $1`,
      [order.id, status]
    );
  } else {
    await client.query('UPDATE orders SET updated_at = now() WHERE id = $1', [order.id]);
  }
  return status;
}

// Stops must be handled in route order: returns the first stop that isn't completed.
function nextStop(stops) {
  return stops.find((s) => s.status !== 'completed');
}

async function arriveAtStop(client, driver, orderId, stopId) {
  const { order, stops } = await lockDriverOrder(client, driver.id, orderId);
  const stop = nextStop(stops);
  if (!stop || stop.id !== stopId) throw new HttpError(409, 'Stops must be completed in order; this is not the next stop');
  if (stop.status === 'pending') {
    stop.status = 'arrived';
    await client.query("UPDATE stops SET status = 'arrived', arrived_at = now() WHERE id = $1", [stop.id]);
    await recordEvent(client, order.id, driver.id, 'stop_arrived', { stopId: stop.id, type: stop.type });
  }
  return applyDerivedStatus(client, order, stops);
}

async function completeStop(client, driver, orderId, stopId, { signature, photo, printedName, barcode }) {
  const { order, stops } = await lockDriverOrder(client, driver.id, orderId);
  const stop = nextStop(stops);
  if (!stop || stop.id !== stopId) throw new HttpError(409, 'Stops must be completed in order; this is not the next stop');
  if (!signature && !photo && !barcode) throw new HttpError(400, 'A signature, photo or barcode scan is required');
  stop.status = 'completed';
  await client.query(
    `UPDATE stops SET status = 'completed', arrived_at = COALESCE(arrived_at, now()), completed_at = now(),
       signature = $2, photo = $3, printed_name = $4, barcode = $5 WHERE id = $1`,
    [stop.id, signature || null, photo || null, str(printedName) || null, barcode || null]
  );
  await recordEvent(client, order.id, driver.id, 'stop_completed', {
    stopId: stop.id, type: stop.type, printedName: str(printedName) || undefined, barcode: barcode || undefined,
  });
  const status = await applyDerivedStatus(client, order, stops);
  if (status === 'completed') await recordEvent(client, order.id, driver.id, 'completed');
  return status;
}

module.exports = {
  ACTIVE, recordEvent, createOrder, bookQuote, repriceOrder, visibilityFilter, ORDER_SELECT, serializeOrder, loadStops,
  getOrderFor, arriveAtStop, completeStop, nextStop, normalizeStops, insertStops,
};
