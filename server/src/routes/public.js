// No-login endpoints used by the public website (www.choicedeliverysc.com).
const express = require('express');
const db = require('../db');
const { sendMail } = require('../mailer');
const { rateLimit } = require('../rate-limit');
const {
  SERVICE_LEVELS, BUSINESS_PLANS, OVERAGE_CENTS, VEHICLE_TYPES, BASE_FEE_CENTS, BASE_MILES, PER_MILE_CENTS, RUSH_FEE_CENTS,
  SURCHARGES, isServiceLevel, normalizeServiceLevel, calculatePrice, routeMiles, pricingContext, getFees, parseWeightLbs,
  CHARGE_KINDS,
} = require('../pricing');
const { asyncH, HttpError, str, parseLocation } = require('../util');
const { searchAddresses, haversineMiles, HOME_BASE, SERVICE_RADIUS_MILES } = require('../geocode');

const router = express.Router();
const limitWrites = rateLimit({ windowMs: 10 * 60 * 1000, max: 8 });

const LEADS_EMAIL = () => process.env.LEADS_EMAIL || 'info@choicedeliverysc.com';
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const limit = (s, n) => str(s).slice(0, n);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

router.get('/pricing', asyncH(async (req, res) => {
  const { badWeather } = await pricingContext(db);
  res.json({
    surcharges: Object.entries(SURCHARGES).map(([id, sc]) => ({ id, ...sc })),
    badWeather,
    baseFeeCents: BASE_FEE_CENTS,
    baseMiles: BASE_MILES,
    perMileCents: PER_MILE_CENTS,
    rushFeeCents: RUSH_FEE_CENTS,
    vehicleTypes: VEHICLE_TYPES,
    serviceLevels: Object.entries(SERVICE_LEVELS).map(([id, s]) => ({ id, ...s })),
    businessPlans: Object.entries(BUSINESS_PLANS).map(([id, p]) => ({ id, ...p })),
    overageCents: OVERAGE_CENTS,
    fees: await getFees(db),
    chargeKinds: CHARGE_KINDS,
  });
}));

// Address suggestions for the booking form (SC/NC/GA only).
router.get('/geocode', rateLimit({ windowMs: 60 * 1000, max: 40 }), asyncH(async (req, res) => {
  try {
    res.json(await searchAddresses(req.query.q));
  } catch (e) {
    console.error('Geocode failed:', e.message);
    res.status(502).json({ message: 'Address suggestions are unavailable right now; you can still type the full address.' });
  }
}));

async function locate(address, given) {
  const loc = parseLocation(given);
  if (loc) return loc;
  if (!str(address)) return null;
  try { return (await searchAddresses(address))[0]?.location || null; } catch { return null; }
}

// Instant quote using the same formula orders are priced with.
// Body: { stops: [{address, location?}, ...] } or { pickupAddress, dropoffAddress, pickupLocation?, dropoffLocation? },
// plus serviceLevel ('standard' | 'rush'), vehicleType and an optional scheduledAt (pickup time).
router.post('/quote', rateLimit({ windowMs: 60 * 1000, max: 30 }), asyncH(async (req, res) => {
  const b = req.body || {};
  const stops = Array.isArray(b.stops) && b.stops.length >= 2
    ? b.stops.slice(0, 20)
    : [{ address: b.pickupAddress, location: b.pickupLocation }, { address: b.dropoffAddress, location: b.dropoffLocation }];
  if (stops.some((st) => !str(st?.address) && !parseLocation(st?.location))) {
    throw new HttpError(400, 'Please enter both pickup and delivery addresses');
  }
  const serviceLevel = isServiceLevel(b.serviceLevel) ? normalizeServiceLevel(b.serviceLevel) : 'standard';
  const locations = await Promise.all(stops.map((st) => locate(st.address, st.location)));
  const at = b.scheduledAt && !Number.isNaN(Date.parse(b.scheduledAt)) ? new Date(b.scheduledAt) : new Date();
  const fees = await getFees(db);
  const addOns = Array.isArray(b.addOns) ? b.addOns.filter((k) => typeof k === 'string') : [];
  const quote = calculatePrice({
    distanceMiles: routeMiles(locations), serviceLevel, at, ...(await pricingContext(db)),
    weightLbs: parseWeightLbs(b.weightLbs ?? b.weight), stopCount: stops.length, addOns, fees,
  });
  const outOfArea = locations.some((l) => l && haversineMiles(HOME_BASE, l) > SERVICE_RADIUS_MILES);
  res.json({
    ...quote,
    priceCents: quote.totalCents,
    extraChargesNote: `Wait time over ${fees.waitFreeMinutes} minutes at a stop ($${(fees.waitBlockCents / 100).toFixed(2)} per `
      + `${fees.waitBlockMinutes} min), loading help, stairs, return trips and failed attempts may be charged extra.`,
    outOfArea,
    note: outOfArea
      ? `One of these addresses is outside our ${SERVICE_RADIUS_MILES}-mile service area. Call (803) 949-7034 and we'll see what we can do.`
      : quote.distanceConfirmed
        ? 'Estimate based on approximate driving distance. Final price is confirmed when your order is booked.'
        : "We couldn't pinpoint one of the addresses, so this is the base price. Final price is confirmed when your order is booked.",
  });
}));

async function saveLead(req, lead) {
  // Hidden "website" field: humans leave it empty, spam bots fill it in.
  if (str(req.body?.website)) return;
  const { rows } = await db.query(
    `INSERT INTO leads (type, name, company, email, phone, message, plan, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
    [lead.type, lead.name, lead.company, lead.email, lead.phone, lead.message, lead.plan || null, req.ip]
  );
  const subject = lead.type === 'contract'
    ? `Business plan request: ${BUSINESS_PLANS[lead.plan]?.name} — ${lead.company || lead.name}`
    : `Website message from ${lead.name}`;
  const rowsHtml = [['Name', lead.name], ['Company', lead.company], ['Email', lead.email], ['Phone', lead.phone],
    ['Plan', lead.plan && BUSINESS_PLANS[lead.plan]?.name], ['Message', lead.message]]
    .filter(([, v]) => v).map(([k, v]) => `<p><strong>${k}:</strong> ${escapeHtml(v)}</p>`).join('');
  const base = process.env.PUBLIC_URL || '';
  sendMail({
    to: LEADS_EMAIL(),
    subject,
    html: `${rowsHtml}${base ? `<p><a href="${base}/#/leads">Open leads in Choice Delivery</a></p>` : ''}`,
  }).catch((e) => console.error('Lead email failed:', e.message));
  return rows[0];
}

router.post('/contact', limitWrites, asyncH(async (req, res) => {
  const b = req.body || {};
  const name = limit(`${str(b.firstName)} ${str(b.lastName)}`.trim() || b.name, 120);
  const email = limit(b.email, 200).toLowerCase();
  const message = limit(b.message, 5000);
  if (!name || !isEmail(email) || !message) throw new HttpError(400, 'Please include your name, a valid email and a message');
  await saveLead(req, { type: 'contact', name, email, phone: limit(b.phone, 40), company: limit(b.company, 200), message });
  res.status(201).json({ message: "Thanks! We'll get back to you within 24 hours." });
}));

router.post('/contract-request', limitWrites, asyncH(async (req, res) => {
  const b = req.body || {};
  if (!BUSINESS_PLANS[b.plan]) throw new HttpError(400, 'Unknown plan');
  const name = limit(b.name, 120);
  const email = limit(b.email, 200).toLowerCase();
  if (!name || !isEmail(email)) throw new HttpError(400, 'Please include your name and a valid email');
  await saveLead(req, {
    type: 'contract', plan: b.plan, name, email,
    phone: limit(b.phone, 40), company: limit(b.company, 200), message: limit(b.message, 5000),
  });
  res.status(201).json({ message: `Thanks! Your request for the ${BUSINESS_PLANS[b.plan].name} is in. We'll contact you within 24 hours.` });
}));

module.exports = router;
