// Order domain logic shared by the routes and import scripts.
const db = require('./db');
const { HttpError, parseLocation, str } = require('./util');
const { isStaff } = require('./auth');
const stripe = require('./stripe');
const { locate, haversineMiles } = require('./geocode');
const {
  isServiceLevel, normalizeServiceLevel, calculatePrice, routeMiles, pricingContext, getFees, parseWeightLbs, DEFAULT_FEES,
  pieceWeightProblem,
} = require('./pricing');

function parsePieceLbs(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'maxPieceLbs must be a positive number of pounds');
  return n;
}

// Rejects orders with a piece over the limit (checked on create, edit and when a quote is booked).
async function assertPieceWeights(client, orderId) {
  const { rows: [o] } = await client.query(
    'SELECT max_piece_lbs, weight, number_of_pieces FROM orders WHERE id = $1', [orderId]);
  const problem = pieceWeightProblem(
    { maxPieceLbs: o.max_piece_lbs, weightLbs: parseWeightLbs(o.weight), pieces: o.number_of_pieces }, await getFees(client));
  if (problem) throw new HttpError(400, `${problem} Call (803) 949-7034 if you have questions.`);
}

// Add-ons are the keys of the fee settings (loading_help, inside_delivery).
function normalizeAddOns(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((k) => !Object.prototype.hasOwnProperty.call(DEFAULT_FEES.addOns, k))) {
    throw new HttpError(400, `addOns must be a list of: ${Object.keys(DEFAULT_FEES.addOns).join(', ')}`);
  }
  return [...new Set(value)];
}

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

// Fills in map locations for typed addresses that weren't picked from the suggestions, the same
// way the quote does, so the order is priced for the distance the customer was quoted.
async function locateStops(stops) {
  await Promise.all(stops.map(async (s) => { if (!s.location) s.location = await locate(s.address); }));
  return stops;
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
  const addOns = normalizeAddOns(body.addOns);
  const maxPieceLbs = parsePieceLbs(body.maxPieceLbs);
  if (maxPieceLbs == null && actor.role === 'shipper') {
    throw new HttpError(400, 'Enter the weight of the heaviest single piece');
  }
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
                           status, booked_at, add_ons, max_piece_lbs)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $13 = 'quote' THEN NULL ELSE now() END, $14, $15)
       RETURNING id`,
      [organizationId, actor.id, str(body.vehicleType), str(body.weight), str(body.numberOfPieces),
        str(body.description), str(body.trackingNumber) || null, priceCents, priceCents != null,
        body.scheduledAt || null, serviceLevel, paymentStatus, isQuote ? 'quote' : 'pending', addOns, maxPieceLbs]
    ));
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'That tracking number is already in use');
    if (e.code === '23503') throw new HttpError(400, 'Organization not found');
    if (e.code === '22007' || e.code === '22008') throw new HttpError(400, 'scheduledAt must be a date/time');
    throw e;
  }
  const orderId = rows[0].id;
  await assertPieceWeights(client, orderId);
  await insertStops(client, orderId, await locateStops(stops));
  await repriceOrder(client, orderId, { fresh: true });
  // Too heavy, over capacity, etc.: held as a quote until dispatch prices it by hand.
  const { rows: [priced] } = await client.query('SELECT price_breakdown, price_is_custom FROM orders WHERE id = $1', [orderId]);
  if (priced.price_breakdown?.needsReview && !priced.price_is_custom) {
    await client.query(
      "UPDATE orders SET status = 'quote', booked_at = NULL, review_status = 'needed' WHERE id = $1", [orderId]);
    await recordEvent(client, orderId, actor.id, 'review_requested', { reasons: priced.price_breakdown.reviewReasons });
    return orderId;
  }
  // The customer was shown a different price (e.g. busy time started while they filled the form):
  // keep it as a quote with the new price instead of booking, so nobody pays an amount they didn't see.
  const { rows: [{ price_cents: cents }] } = await client.query('SELECT price_cents FROM orders WHERE id = $1', [orderId]);
  if (!isQuote && body.expectedCents != null && priceCents == null && Number(body.expectedCents) !== cents) {
    await client.query("UPDATE orders SET status = 'quote', booked_at = NULL WHERE id = $1", [orderId]);
    await recordEvent(client, orderId, actor.id, 'quoted');
    await recordEvent(client, orderId, actor.id, 'repriced', { fromCents: Number(body.expectedCents), toCents: cents });
    return orderId;
  }
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
    `SELECT o.status, o.organization_id, o.scheduled_at, o.price_cents, o.review_status, u.role AS creator_role
     FROM orders o LEFT JOIN users u ON u.id = o.created_by WHERE o.id = $1 FOR UPDATE OF o`, [orderId]);
  if (!o) throw new HttpError(404, 'Order not found');
  if (o.status !== 'quote') throw new HttpError(409, 'This order is already booked');
  if (o.review_status === 'needed') throw new HttpError(409, "We're still reviewing this request; we'll email you the price");
  await assertPieceWeights(client, orderId);
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
    `SELECT status, service_level, scheduled_at, booked_at, created_at, price_breakdown, weight, add_ons, vehicle_type
     FROM orders WHERE id = $1`, [orderId]);
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
    vehicleType: o.vehicle_type,
    weightLbs: parseWeightLbs(o.weight),
    stopCount: stops.length,
    addOns: o.add_ons,
    fees: await getFees(client),
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
  // Drivers never see sample (demo) orders. Unpaid card orders stay hidden until payment clears.
  // Drivers who aren't approved yet (applied, rejected, suspended) see no open jobs.
  const openPool = user.driver_status && user.driver_status !== 'approved' ? 'FALSE'
    : "(o.status = 'pending' AND o.driver_id IS NULL AND o.payment_status <> 'unpaid')";
  return `NOT o.is_demo AND (o.driver_id = $${params.length} OR ${openPool})`;
}

const ORDER_SELECT = `
  SELECT o.*, org.name AS organization_name,
         (SELECT COALESCE(sum(cents), 0) FROM order_charges c WHERE c.order_id = o.id AND c.status = 'due')::int AS balance_due_cents,
         (SELECT COALESCE(sum(cents), 0) FROM order_charges c WHERE c.order_id = o.id AND c.status <> 'waived')::int AS extra_charges_cents,
         d.name AS driver_name, d.phone_number AS driver_phone,
         d.last_location AS driver_location, d.location_updated_at AS driver_location_updated_at,
         dv.color AS driver_vehicle_color, dv.make AS driver_vehicle_make, dv.model AS driver_vehicle_model,
         dv.plate AS driver_vehicle_plate, dp.updated_at AS driver_photo_at
  FROM orders o
  LEFT JOIN organizations org ON org.id = o.organization_id
  LEFT JOIN users d ON d.id = o.driver_id
  LEFT JOIN LATERAL (SELECT color, make, model, plate FROM vehicles v WHERE v.driver_id = o.driver_id
                     ORDER BY v.created_at LIMIT 1) dv ON true
  LEFT JOIN LATERAL (SELECT updated_at FROM driver_documents dd WHERE dd.user_id = o.driver_id AND dd.kind = 'photo') dp ON true`;

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
    // How far the driver's phone was from the address (meters); null if the address wasn't on the map.
    arrivedDistanceM: s.arrived_distance_m,
    completedDistanceM: s.completed_distance_m,
  };
  if (proof) Object.assign(out, { signature: s.signature, photo: s.photo, barcode: s.barcode });
  return out;
}

function serializeCharge(c) {
  return {
    id: c.id, kind: c.kind, description: c.description, cents: c.cents, minutes: c.minutes, stopId: c.stop_id,
    status: c.status, paidAt: c.paid_at, createdAt: c.created_at,
  };
}

function serializeOrder(o, stops, { events, charges, proof = false, user } = {}) {
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
      vehicle: [o.driver_vehicle_color, o.driver_vehicle_make, o.driver_vehicle_model].filter(Boolean).join(' ') || null,
      plate: o.driver_vehicle_plate || null,
      photoUrl: o.driver_photo_at ? `/public/driver-photo/${o.driver_id}?v=${new Date(o.driver_photo_at).getTime()}` : null,
      ...(showDriverLocation ? { location: o.driver_location, locationUpdatedAt: o.driver_location_updated_at } : {}),
    } : null,
    serviceLevel: o.service_level,
    isQuote: o.status === 'quote',
    reviewStatus: o.review_status,
    distanceMiles: o.distance_miles == null ? null : Number(o.distance_miles),
    priceBreakdown: o.price_breakdown,
    priceIsCustom: o.price_is_custom,
    paymentStatus: o.payment_status,
    paidCents: o.paid_cents,
    paidAt: o.paid_at,
    paymentMethod: o.payment_method,
    refundedCents: o.refunded_cents,
    addOns: o.add_ons || [],
    maxPieceLbs: o.max_piece_lbs == null ? null : Number(o.max_piece_lbs),
    extraChargesCents: o.extra_charges_cents ?? 0,
    balanceDueCents: o.balance_due_cents ?? 0,
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
  if (charges) out.charges = charges.map(serializeCharge);
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
  const { rows: charges } = await client.query(
    'SELECT * FROM order_charges WHERE order_id = $1 ORDER BY created_at', [id]);
  return serializeOrder(rows[0], stops, { events, charges, proof: true, user });
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

// How close (meters) the driver's phone must be to a stop's address to arrive at or complete it,
// plus up to MAX_ACCURACY_ALLOWANCE_M for the phone's reported GPS accuracy.
const STOP_RADIUS_M = Number(process.env.STOP_RADIUS_METERS) || 500;
const MAX_ACCURACY_ALLOWANCE_M = 150;
const LAST_LOCATION_MAX_AGE_MS = 2 * 60 * 1000;

// Checks the driver is at the stop. Uses the location the app sent with the request, else the
// driver's last shared location if it's fresh. Returns { location, distanceM } (distanceM is null
// when the stop's address couldn't be put on the map, so there's nothing to compare against).
async function verifyAtStop(client, driverId, stop, sent) {
  if (sent?.mocked) throw new HttpError(403, 'Your phone is using a fake (mock) location. Turn it off to continue.');
  let location = parseLocation(sent);
  let accuracy = Number(sent?.accuracy);
  if (!location) {
    const { rows: [u] } = await client.query('SELECT last_location, location_updated_at FROM users WHERE id = $1', [driverId]);
    if (u?.last_location && Date.now() - new Date(u.location_updated_at).getTime() < LAST_LOCATION_MAX_AGE_MS) {
      location = parseLocation(u.last_location);
      accuracy = NaN;
    }
  }
  if (!location) {
    throw new HttpError(400, "We need your phone's location to confirm you're at this stop. Turn on location for Choice Delivery and try again.");
  }
  const target = parseLocation(stop.location);
  if (!target) return { location, distanceM: null };
  const distanceM = Math.round(haversineMiles(location, target) * 1609.34);
  const allowance = Number.isFinite(accuracy) && accuracy > 0 ? Math.min(accuracy, MAX_ACCURACY_ALLOWANCE_M) : 0;
  if (distanceM > STOP_RADIUS_M + allowance) {
    const away = distanceM >= 1609 ? `${(distanceM / 1609.34).toFixed(1)} miles` : `${Math.round(distanceM * 3.281)} feet`;
    throw new HttpError(409, `You're about ${away} from this ${stop.type === 'pickup' ? 'pickup' : 'drop-off'}. `
      + "Get to the address first. If you're there and still see this, call dispatch at (803) 949-7034.");
  }
  return { location, distanceM };
}

async function arriveAtStop(client, driver, orderId, stopId, { location } = {}) {
  const { order, stops } = await lockDriverOrder(client, driver.id, orderId);
  const stop = nextStop(stops);
  if (!stop || stop.id !== stopId) throw new HttpError(409, 'Stops must be completed in order; this is not the next stop');
  if (stop.status === 'pending') {
    const at = await verifyAtStop(client, driver.id, stop, location);
    stop.status = 'arrived';
    await client.query(
      "UPDATE stops SET status = 'arrived', arrived_at = now(), arrived_location = $2, arrived_distance_m = $3 WHERE id = $1",
      [stop.id, JSON.stringify(at.location), at.distanceM]);
    await recordEvent(client, order.id, driver.id, 'stop_arrived', { stopId: stop.id, type: stop.type, distanceM: at.distanceM });
  }
  return applyDerivedStatus(client, order, stops);
}

async function completeStop(client, driver, orderId, stopId, { signature, photo, printedName, barcode, location }) {
  const { order, stops } = await lockDriverOrder(client, driver.id, orderId);
  const stop = nextStop(stops);
  if (!stop || stop.id !== stopId) throw new HttpError(409, 'Stops must be completed in order; this is not the next stop');
  // A scanned barcode is extra proof only; not every shipment has one, so it never replaces these.
  if (stop.type === 'dropoff') {
    if (!photo || !signature) throw new HttpError(400, 'A delivery photo and the receiver\'s signature are both required');
  } else if (!signature && !photo) throw new HttpError(400, 'A signature or photo is required');
  if (stop.status === 'pending') throw new HttpError(409, "Tap \"I've arrived\" at this stop first");
  const at = await verifyAtStop(client, driver.id, stop, location);
  stop.status = 'completed';
  await client.query(
    `UPDATE stops SET status = 'completed', arrived_at = COALESCE(arrived_at, now()), completed_at = now(),
       signature = $2, photo = $3, printed_name = $4, barcode = COALESCE($5, barcode),
       completed_location = $6, completed_distance_m = $7 WHERE id = $1`,
    [stop.id, signature || null, photo || null, str(printedName) || null, barcode || null,
      JSON.stringify(at.location), at.distanceM]
  );
  await recordEvent(client, order.id, driver.id, 'stop_completed', {
    stopId: stop.id, type: stop.type, printedName: str(printedName) || undefined, barcode: barcode || undefined,
    distanceM: at.distanceM,
  });
  const status = await applyDerivedStatus(client, order, stops);
  if (status === 'completed') await recordEvent(client, order.id, driver.id, 'completed');
  return status;
}

module.exports = {
  ACTIVE, recordEvent, createOrder, bookQuote, normalizeAddOns, parsePieceLbs, assertPieceWeights, repriceOrder, visibilityFilter, ORDER_SELECT, serializeOrder, loadStops,
  getOrderFor, arriveAtStop, completeStop, nextStop, normalizeStops, locateStops, insertStops,
};
