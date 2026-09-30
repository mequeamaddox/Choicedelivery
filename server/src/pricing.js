// Delivery pricing for Choice Delivery SC, carried over from the original app's shared/pricing.ts.
//
//   $25 base (covers the first 5 miles)
//   + $1.50 per mile over 5
//   + $50 rush (2 hours or less)
//   + surcharges: weekend $10, lunch rush (11:30am-1:30pm) $5, high demand (3+ open orders) $15,
//     bad weather $15 (switched on by dispatch)
//
// Plus the extras below (defaults; the owner can change the amounts on the Account page):
//   weight tiers, $10 per extra stop, optional add-ons (loading help, inside delivery/stairs),
//   and wait time billed after the order (first 15 minutes at each stop free, then $10 per 15 minutes).
//
// Times are Columbia, SC local time. For scheduled deliveries the pickup time counts.
// Dispatch can override the price of any order.

const TIME_ZONE = 'America/New_York';
const BASE_FEE_CENTS = 2500;
const BASE_MILES = 5;
const PER_MILE_CENTS = 150;
const RUSH_FEE_CENTS = 5000;

const SURCHARGES = {
  weather: { label: 'Weather conditions', cents: 1500 },
  lunch: { label: 'Lunch rush (11:30am–1:30pm)', cents: 500 },
  demand: { label: 'High demand', cents: 1500 },
  weekend: { label: 'Weekend service', cents: 1000 },
};
const LUNCH_START = 11.5;
const LUNCH_END = 13.5;
const HIGH_DEMAND_OPEN_ORDERS = 3;

const VEHICLE_TYPES = ['Car', 'Minivan', 'Cargo Van', 'Truck'];

// Modeled on how Curri and other couriers charge: heavier loads, extra stops and driver labor cost more,
// and waiting past a free window is billed. Amounts are stored in settings ('fees') and editable.
const DEFAULT_FEES = {
  // Tiers by total declared weight; the last tier (upToLbs: null) covers everything heavier.
  weightTiers: [
    { upToLbs: 50, cents: 0 },
    { upToLbs: 150, cents: 1500 },
    { upToLbs: 500, cents: 3500 },
    { upToLbs: 1000, cents: 7500 },
    { upToLbs: null, cents: 12500 },
  ],
  extraStopCents: 1000, // each stop beyond one pickup and one drop-off
  addOns: {
    loading_help: { label: 'Loading/unloading help', description: 'Driver helps load and unload', cents: 2500 },
    inside_delivery: { label: 'Inside delivery / stairs', description: 'Carried inside, upstairs or to a specific room', cents: 2000 },
  },
  waitFreeMinutes: 15, // per stop
  waitBlockMinutes: 15,
  waitBlockCents: 1000,
};

// Charges added after booking (by dispatch), with the reason shown to the customer.
const CHARGE_KINDS = {
  wait_time: 'Wait time',
  extra_weight: 'Heavier than declared',
  labor: 'Loading/unloading help',
  return_trip: 'Return trip',
  failed_attempt: 'Failed delivery attempt',
  other: 'Other',
};

const cleanCents = (v, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 1000000 ? n : fallback;
};

// Merges saved fee settings over the defaults, ignoring anything malformed.
function normalizeFees(saved) {
  const f = saved && typeof saved === 'object' ? saved : {};
  const tiers = Array.isArray(f.weightTiers) && f.weightTiers.length ? f.weightTiers : DEFAULT_FEES.weightTiers;
  const weightTiers = tiers.slice(0, 10).map((t, i, all) => ({
    upToLbs: i === all.length - 1 ? null : cleanCents(t?.upToLbs, null),
    cents: cleanCents(t?.cents, 0),
  })).filter((t, i, all) => i === all.length - 1 || t.upToLbs != null);
  const capped = weightTiers.slice(0, -1).sort((a, b) => a.upToLbs - b.upToLbs)
    .filter((t, i, all) => i === 0 || t.upToLbs > all[i - 1].upToLbs);
  weightTiers.splice(0, weightTiers.length - 1, ...capped);
  const addOns = {};
  for (const [key, def] of Object.entries(DEFAULT_FEES.addOns)) {
    addOns[key] = { ...def, cents: cleanCents(f.addOns?.[key]?.cents, def.cents) };
  }
  return {
    weightTiers,
    extraStopCents: cleanCents(f.extraStopCents, DEFAULT_FEES.extraStopCents),
    addOns,
    waitFreeMinutes: cleanCents(f.waitFreeMinutes, DEFAULT_FEES.waitFreeMinutes),
    waitBlockMinutes: Math.max(1, cleanCents(f.waitBlockMinutes, DEFAULT_FEES.waitBlockMinutes)),
    waitBlockCents: cleanCents(f.waitBlockCents, DEFAULT_FEES.waitBlockCents),
  };
}

async function getFees(client) {
  const { rows } = await client.query("SELECT value FROM settings WHERE key = 'fees'");
  return normalizeFees(rows[0]?.value);
}

// "120 lbs", "120", "1,200 lb" -> number of pounds; null when no number is given.
function parseWeightLbs(text) {
  if (typeof text === 'number') return Number.isFinite(text) && text >= 0 ? text : null;
  const m = String(text ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return /kg|kilo/i.test(String(text)) ? Math.round(n * 2.20462) : n;
}

function weightTierLabel(tiers, index) {
  const lo = index === 0 ? 0 : tiers[index - 1].upToLbs + 1;
  const hi = tiers[index].upToLbs;
  return hi == null ? `Over ${lo - 1} lbs` : index === 0 ? `Up to ${hi} lbs` : `${lo}–${hi} lbs`;
}

// Wait-time charge for a stop: free minutes first, then each started block is billed.
function waitCharge(minutes, fees = DEFAULT_FEES) {
  const billable = Math.max(0, Math.round(minutes) - fees.waitFreeMinutes);
  const blocks = Math.ceil(billable / fees.waitBlockMinutes);
  return { minutes: Math.round(minutes), billableMinutes: billable, cents: blocks * fees.waitBlockCents };
}

const SERVICE_LEVELS = {
  standard: { label: 'Standard delivery', description: 'Scheduled delivery', feeCents: 0 },
  rush: { label: 'Rush delivery', description: '2 hours or less', feeCents: RUSH_FEE_CENTS },
};

// Business plans as advertised on choicedeliverysc.com (chosen over the original app's code, which
// had 10/8/8/6 included deliveries with $40/$30/$35/$25 overages).
const BUSINESS_PLANS = {
  law_firm: { name: 'Law Firm Plan', monthlyCents: 50000, includedDeliveries: 20 },
  medical: { name: 'Medical Office Plan', monthlyCents: 30000, includedDeliveries: 15 },
  real_estate: { name: 'Real Estate Plan', monthlyCents: 40000, includedDeliveries: 18 },
  usc_department: { name: 'USC Department Plan', monthlyCents: 20000, includedDeliveries: 12 },
};
const OVERAGE_CENTS = 1500;

const normalizeServiceLevel = (v) => (v === 'same_day' ? 'rush' : v);
const isServiceLevel = (v) => Object.prototype.hasOwnProperty.call(SERVICE_LEVELS, normalizeServiceLevel(v));

// Local day-of-week and fractional hour in Columbia for a given instant.
function localTime(at) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { weekday: get('weekday'), hour: Number(get('hour')) + Number(get('minute')) / 60 };
}

// distanceMiles may be null when addresses couldn't be located; no distance fee then, and the
// quote says the distance still needs confirming.
// `at` is when the pickup happens (defaults to now); openOrders and badWeather come from the system.
// weightLbs, stopCount (default 2) and addOns (keys of fees.addOns) add the extras above.
function calculatePrice({
  distanceMiles, serviceLevel = 'standard', at = new Date(), openOrders = 0, badWeather = false,
  weightLbs = null, stopCount = 2, addOns = [], fees = DEFAULT_FEES,
}) {
  const level = normalizeServiceLevel(serviceLevel);
  const miles = distanceMiles == null ? null : Math.round(Number(distanceMiles) * 10) / 10;
  const extraMiles = miles == null ? 0 : Math.max(0, Math.round((miles - BASE_MILES) * 10) / 10);
  const extraMileageCents = Math.round(extraMiles * PER_MILE_CENTS);
  const rushFeeCents = SERVICE_LEVELS[level]?.feeCents ?? 0;

  const { weekday, hour } = localTime(at instanceof Date ? at : new Date(at));
  const applies = {
    weather: !!badWeather,
    lunch: hour >= LUNCH_START && hour <= LUNCH_END,
    demand: openOrders >= HIGH_DEMAND_OPEN_ORDERS,
    weekend: weekday === 'Sat' || weekday === 'Sun',
  };
  const surcharges = Object.entries(SURCHARGES)
    .filter(([key]) => applies[key])
    .map(([key, s]) => ({ key, label: s.label, cents: s.cents }));
  const surchargeCents = surcharges.reduce((sum, s) => sum + s.cents, 0);

  const lbs = weightLbs == null || weightLbs === '' ? null : Number(weightLbs);
  let weightFeeCents = 0;
  let weightTier = null;
  if (lbs != null && Number.isFinite(lbs)) {
    const i = fees.weightTiers.findIndex((t) => t.upToLbs == null || lbs <= t.upToLbs);
    weightFeeCents = fees.weightTiers[i].cents;
    weightTier = weightTierLabel(fees.weightTiers, i);
  }
  const extraStops = Math.max(0, (Number(stopCount) || 2) - 2);
  const extraStopsCents = extraStops * fees.extraStopCents;
  const addOnLines = [...new Set(addOns)].filter((k) => fees.addOns[k])
    .map((k) => ({ key: k, label: fees.addOns[k].label, cents: fees.addOns[k].cents }));
  const addOnCents = addOnLines.reduce((sum, a) => sum + a.cents, 0);

  return {
    distanceMiles: miles,
    distanceConfirmed: miles != null,
    baseFeeCents: BASE_FEE_CENTS,
    baseMiles: BASE_MILES,
    extraMiles,
    perMileCents: PER_MILE_CENTS,
    extraMileageCents,
    serviceLevel: level,
    rushFeeCents,
    surcharges,
    weightLbs: lbs != null && Number.isFinite(lbs) ? lbs : null,
    weightTier,
    weightFeeCents,
    extraStops,
    extraStopsCents,
    addOns: addOnLines,
    context: { at: new Date(at).toISOString(), openOrders, badWeather: !!badWeather },
    totalCents: BASE_FEE_CENTS + extraMileageCents + rushFeeCents + surchargeCents + weightFeeCents + extraStopsCents + addOnCents,
  };
}

// Approximate road miles along a route: straight-line distance x 1.2.
function routeMiles(locations) {
  if (!locations.length || locations.some((l) => !l)) return null;
  const R = 3958.8;
  const rad = (d) => (d * Math.PI) / 180;
  let miles = 0;
  for (let i = 1; i < locations.length; i++) {
    const a = locations[i - 1];
    const b = locations[i];
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
      + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    miles += 2 * R * Math.asin(Math.sqrt(h));
  }
  return Math.round(miles * 1.2 * 10) / 10;
}

// Live inputs for surcharges: open orders (excluding one being repriced) and the weather switch.
async function pricingContext(client, excludeOrderId = null) {
  const { rows: [{ n }] } = await client.query(
    `SELECT count(*)::int AS n FROM orders
     WHERE status IN ('pending', 'accepted', 'at_pickup', 'in_transit', 'at_dropoff') AND NOT is_demo
       AND ($1::uuid IS NULL OR id <> $1)`, [excludeOrderId]);
  const { rows } = await client.query("SELECT value FROM settings WHERE key = 'bad_weather'");
  return { openOrders: n, badWeather: rows[0]?.value === true };
}

module.exports = {
  TIME_ZONE, BASE_FEE_CENTS, BASE_MILES, PER_MILE_CENTS, RUSH_FEE_CENTS, SURCHARGES, HIGH_DEMAND_OPEN_ORDERS,
  VEHICLE_TYPES, SERVICE_LEVELS, BUSINESS_PLANS, OVERAGE_CENTS, DEFAULT_FEES, CHARGE_KINDS,
  normalizeFees, getFees, parseWeightLbs, weightTierLabel, waitCharge, normalizeServiceLevel, isServiceLevel, calculatePrice, routeMiles, pricingContext, localTime,
};
