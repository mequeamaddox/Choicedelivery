// Delivery pricing for Choice Delivery SC, carried over from the original app's shared/pricing.ts.
//
//   $25 base (covers the first 5 miles)
//   + $1.50 per mile over 5
//   + $50 rush (2 hours or less)
//   + surcharges: weekend $10, lunch rush (11:30am-1:30pm) $5, high demand (3+ open orders) $15,
//     bad weather $15 (switched on by dispatch)
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

const SERVICE_LEVELS = {
  standard: { label: 'Standard delivery', description: 'Scheduled delivery', feeCents: 0 },
  rush: { label: 'Rush delivery', description: '2 hours or less', feeCents: RUSH_FEE_CENTS },
};

// Business plans as advertised on www.choicedeliverysc.com.
// NOTE: the original app's code had different included deliveries and overage fees
// (law 10/$40, medical 8/$30, real estate 8/$35, USC 6/$25). Confirm which is right.
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
function calculatePrice({ distanceMiles, serviceLevel = 'standard', at = new Date(), openOrders = 0, badWeather = false }) {
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
    context: { at: new Date(at).toISOString(), openOrders, badWeather: !!badWeather },
    totalCents: BASE_FEE_CENTS + extraMileageCents + rushFeeCents + surchargeCents,
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
     WHERE status IN ('pending', 'accepted', 'at_pickup', 'in_transit', 'at_dropoff')
       AND ($1::uuid IS NULL OR id <> $1)`, [excludeOrderId]);
  const { rows } = await client.query("SELECT value FROM settings WHERE key = 'bad_weather'");
  return { openOrders: n, badWeather: rows[0]?.value === true };
}

module.exports = {
  TIME_ZONE, BASE_FEE_CENTS, BASE_MILES, PER_MILE_CENTS, RUSH_FEE_CENTS, SURCHARGES, HIGH_DEMAND_OPEN_ORDERS,
  VEHICLE_TYPES, SERVICE_LEVELS, BUSINESS_PLANS, OVERAGE_CENTS,
  normalizeServiceLevel, isServiceLevel, calculatePrice, routeMiles, pricingContext, localTime,
};
