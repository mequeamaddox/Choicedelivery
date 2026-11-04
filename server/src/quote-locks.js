// Emailed quotes are honored: someone who was emailed a quote ("Email me this quote" on the website, or
// one dispatch sent from there after a phone call) and then books the same trip with that email address
// gets the quoted price, not today's recalculated one. Same trip means: same vehicle, the same or a lower
// service level, no more weight or add-ons than quoted, the same number of stops, and each stop within
// RADIUS_MILES of the place quoted (so a ZIP code quote still matches the street address in that area).
const db = require('./db');
const { locate, haversineMiles } = require('./geocode');

const LOCK_DAYS = 14;
const RADIUS_MILES = 10;

async function saveLock({ email, leadId, quote, addresses, locations, weightLbs, addOns }) {
  // Jobs we price by hand or confirm first (far pickups) aren't locked: those go through dispatch.
  if (!email || !quote || quote.needsReview || quote.needsApproval || !(quote.totalCents > 0)) return null;
  const { rows: [r] } = await db.query(
    `INSERT INTO quote_locks (email, lead_id, price_cents, vehicle_type, service_level, weight_lbs, add_ons, addresses, locations, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(days => $10)) RETURNING id`,
    [String(email).toLowerCase(), leadId || null, quote.totalCents, quote.vehicleType || 'Car', quote.serviceLevel || 'standard',
      weightLbs ?? null, addOns || [], addresses, JSON.stringify(locations || []), LOCK_DAYS]);
  return r.id;
}

// The newest open lock for this email that matches the trip, or null. trip: { vehicleType, serviceLevel,
// weightLbs, addOns, locations, weightFeeCents }.
async function findLock(client, email, trip) {
  if (!email) return null;
  const { rows } = await client.query(
    `SELECT * FROM quote_locks WHERE email = lower($1) AND order_id IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 10`,
    [String(email)]);
  for (const r of rows) {
    if ((r.vehicle_type || 'Car') !== (trip.vehicleType || 'Car')) continue;
    if (r.service_level === 'standard' && trip.serviceLevel === 'rush') continue;
    if (r.weight_lbs == null ? trip.weightFeeCents > 0 : trip.weightLbs != null && Number(trip.weightLbs) > Number(r.weight_lbs)) continue;
    if ((trip.addOns || []).some((k) => !(r.add_ons || []).includes(k))) continue;
    let quoted = Array.isArray(r.locations) ? r.locations : [];
    if (quoted.length !== r.addresses.length || quoted.some((l) => !l)) {
      quoted = await Promise.all(r.addresses.map((a) => locate(a).catch(() => null)));
    }
    const here = trip.locations || [];
    if (here.length !== quoted.length) continue;
    if (!here.every((l, i) => l && quoted[i] && haversineMiles(l, quoted[i]) <= RADIUS_MILES)) continue;
    return { id: r.id, priceCents: r.price_cents, createdAt: r.created_at };
  }
  return null;
}

async function useLock(client, lockId, orderId) {
  await client.query('UPDATE quote_locks SET order_id = $2 WHERE id = $1', [lockId, orderId]);
}

module.exports = { saveLock, findLock, useLock, LOCK_DAYS, RADIUS_MILES };
