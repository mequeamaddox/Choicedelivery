// Delivery pricing for Choice Delivery SC (the owner's rate card; every amount below is a default the
// owner can change under Account → Fees & extra charges):
//
//   By vehicle, each base covering the first 10 miles:
//     Car $25 then $1.50/mile · Minivan $35 then $2.00/mile · Pickup Truck $45 then $2.50/mile
//   + $50 rush (2 hours or less)
//   + surcharges: weekend $15, holiday $25 (instead of the weekend charge, not on top of it),
//     and from the original app: high demand (3+ open orders) $15, bad weather $15 (switched on by
//     dispatch); lunch rush (11:30am-1:30pm) $5 exists but is off
//   + weight tiers, $10 per extra stop, optional add-ons (loading help, inside delivery/stairs),
//     and wait time billed after the order (first 15 minutes at each stop free, then $10 per 15 minutes).
//
// Times are Columbia, SC local time. For scheduled deliveries the pickup time counts.
// Dispatch can override the price of any order.

const TIME_ZONE = 'America/New_York';
// Car rates: the "starting at" price, and what unknown/legacy vehicle types are priced at.
const BASE_FEE_CENTS = 2500;
const BASE_MILES = 10;
const PER_MILE_CENTS = 150;
const RUSH_FEE_CENTS = 5000;

const SURCHARGES = {
  holiday: { label: 'Holiday service', cents: 2500 },
  weekend: { label: 'Weekend service', cents: 1500 },
  weather: { label: 'Weather conditions', cents: 1500 },
  lunch: { label: 'Lunch rush (11:30am–1:30pm)', cents: 500 },
  demand: { label: 'High demand', cents: 1500 },
};

// Holidays that get the holiday surcharge (on the day itself, Columbia time). on: default setting.
const HOLIDAYS = {
  new_years_day: { label: "New Year's Day", on: true },
  mlk_day: { label: 'Martin Luther King Jr. Day', on: false },
  presidents_day: { label: "Presidents' Day", on: false },
  memorial_day: { label: 'Memorial Day', on: true },
  juneteenth: { label: 'Juneteenth', on: false },
  independence_day: { label: 'Independence Day', on: true },
  labor_day: { label: 'Labor Day', on: true },
  columbus_day: { label: 'Columbus Day', on: false },
  veterans_day: { label: 'Veterans Day', on: false },
  thanksgiving: { label: 'Thanksgiving', on: true },
  day_after_thanksgiving: { label: 'Day after Thanksgiving', on: true },
  christmas_eve: { label: 'Christmas Eve', on: true },
  christmas: { label: 'Christmas Day', on: true },
  new_years_eve: { label: "New Year's Eve", on: true },
};

// nth (1-based; -1 = last) weekday (0 = Sunday) of a month, as day of month.
function nthWeekday(year, month, weekday, nth) {
  if (nth > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - ((last - weekday + 7) % 7);
}

// Which holiday (key) a local calendar date is, if any.
function holidayOn(year, month, day) {
  const is = (m, d) => month === m && day === d;
  if (is(1, 1)) return 'new_years_day';
  if (is(1, nthWeekday(year, 1, 1, 3))) return 'mlk_day';
  if (is(2, nthWeekday(year, 2, 1, 3))) return 'presidents_day';
  if (is(5, nthWeekday(year, 5, 1, -1))) return 'memorial_day';
  if (is(6, 19)) return 'juneteenth';
  if (is(7, 4)) return 'independence_day';
  if (is(9, nthWeekday(year, 9, 1, 1))) return 'labor_day';
  if (is(10, nthWeekday(year, 10, 1, 2))) return 'columbus_day';
  if (is(11, 11)) return 'veterans_day';
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  if (is(11, thanksgiving)) return 'thanksgiving';
  if (is(11, thanksgiving + 1)) return 'day_after_thanksgiving';
  if (is(12, 24)) return 'christmas_eve';
  if (is(12, 25)) return 'christmas';
  if (is(12, 31)) return 'new_years_eve';
  return null;
}

// Label of the holiday on this local date if its surcharge is switched on (or it's an extra date), else null.
function holidayName(localDate, fees = DEFAULT_FEES) {
  const [y, m, d] = localDate.split('-').map(Number);
  const key = holidayOn(y, m, d);
  if (key && fees.holidays[key]) return HOLIDAYS[key].label;
  if (fees.extraHolidayDates.includes(localDate)) return 'Holiday';
  return null;
}
const LUNCH_START = 11.5;
const LUNCH_END = 13.5;
const HIGH_DEMAND_OPEN_ORDERS = 3;

const VEHICLE_TYPES = ['Car', 'Minivan', 'Cargo Van', 'Pickup Truck'];

// Modeled on how Curri and other couriers charge: heavier loads, extra stops and driver labor cost more,
// and waiting past a free window is billed. Amounts are stored in settings ('fees') and editable.
const DEFAULT_FEES = {
  // Tiers by total declared weight. Anything heavier than the last tier is sent for manual review.
  weightTiers: [
    { upToLbs: 50, cents: 0 },
    { upToLbs: 150, cents: 1500 },
    { upToLbs: 500, cents: 3500 },
    { upToLbs: 1000, cents: 7500 },
  ],
  // Bumped when the default rate card changes, so older saved settings don't override the new rates.
  version: 2,
  // By vehicle: base price covering the first includedMiles, per-mile rate after that, and the most it
  // carries (heavier loads need a bigger vehicle or manual review). The biggest vehicle is a half-ton
  // pickup; there's no liftgate/box-truck service. Cargo Van is off unless the owner turns it on.
  vehicles: {
    Car: { description: 'Envelopes, boxes, small parcels', baseCents: 2500, includedMiles: 10, perMileCents: 150, maxLbs: 150, enabled: true },
    Minivan: { description: 'Several boxes, small furniture', baseCents: 3500, includedMiles: 10, perMileCents: 200, maxLbs: 500, enabled: true },
    'Cargo Van': { description: 'Larger loads that must stay dry', baseCents: 4000, includedMiles: 10, perMileCents: 225, maxLbs: 1000, enabled: false },
    'Pickup Truck': { description: 'Half-ton pickup: bulky or heavy items', baseCents: 4500, includedMiles: 10, perMileCents: 250, maxLbs: 1000, enabled: true },
  },
  rushCents: RUSH_FEE_CENTS,
  // Lunch rush is off by the owner's choice (it can be switched back on).
  surcharges: Object.fromEntries(Object.entries(SURCHARGES).map(([k, sc]) => [k, { cents: sc.cents, enabled: k !== 'lunch' }])),
  holidays: Object.fromEntries(Object.entries(HOLIDAYS).map(([k, h]) => [k, h.on])),
  extraHolidayDates: [], // 'YYYY-MM-DD' (Columbia time), e.g. a closure you want charged as a holiday
  maxPieceLbs: 75, // no single piece heavier than this is accepted (one person has to lift it)
  extraStopCents: 1000, // each stop beyond one pickup and one drop-off
  addOns: {
    loading_help: { label: 'Loading/unloading help', description: 'Driver helps load and unload', cents: 2500 },
    inside_delivery: { label: 'Inside delivery / stairs', description: 'Carried inside, upstairs or to a specific room', cents: 2000 },
  },
  waitFreeMinutes: 15, // per stop
  waitBlockMinutes: 15,
  waitBlockCents: 1000,
  // What drivers earn: a flat amount per job, plus a share of the order's mileage fee (the per-mile
  // charge past the included miles), plus a share of extra charges like wait time. Never more than the
  // price. Dispatch can set a different amount on any order.
  driverPay: { perJobCents: 1000, mileagePercent: 70, extrasPercent: 70 },
};

// Driver pay for an order: per-job amount + share of its mileage fee (from the price breakdown) +
// share of its (not waived) extra charges, under the fee settings.
function driverPayFor(priceCents, extrasCents, fees, breakdown = null) {
  if (priceCents == null) return null;
  const { perJobCents, mileagePercent, extrasPercent } = fees.driverPay;
  const mileage = Math.round(((breakdown?.extraMileageCents || 0) * mileagePercent) / 100);
  const trip = Math.min(priceCents, perJobCents + mileage);
  return trip + Math.round(((extrasCents || 0) * extrasPercent) / 100);
}

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
  if (v === null || v === undefined || v === '') return fallback;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 1000000 ? n : fallback;
};

// Merges saved fee settings over the defaults, ignoring anything malformed.
function normalizeFees(saved) {
  const f = saved && typeof saved === 'object' ? saved : {};
  const tiers = Array.isArray(f.weightTiers) && f.weightTiers.length ? f.weightTiers : DEFAULT_FEES.weightTiers;
  // Every tier has a limit; older settings with an open-ended last tier just drop it (now manual review).
  let weightTiers = tiers.slice(0, 10)
    .map((t) => ({ upToLbs: cleanCents(t?.upToLbs, null), cents: cleanCents(t?.cents, 0) }))
    .filter((t) => t.upToLbs != null && t.upToLbs > 0)
    .sort((a, b) => a.upToLbs - b.upToLbs)
    .filter((t, i, all) => i === 0 || t.upToLbs > all[i - 1].upToLbs);
  if (!weightTiers.length) weightTiers = DEFAULT_FEES.weightTiers;
  // Settings saved before the current rate card keep their other amounts but not vehicle/surcharge rates.
  const current = Number(f.version) >= DEFAULT_FEES.version;
  const vehicles = {};
  for (const [key, def] of Object.entries(DEFAULT_FEES.vehicles)) {
    const v = (current && f.vehicles?.[key]) || {};
    vehicles[key] = {
      description: def.description,
      baseCents: cleanCents(v.baseCents, def.baseCents),
      includedMiles: cleanCents(v.includedMiles, def.includedMiles),
      perMileCents: cleanCents(v.perMileCents, def.perMileCents),
      maxLbs: Math.max(1, cleanCents(v.maxLbs, def.maxLbs)),
      enabled: typeof v.enabled === 'boolean' ? v.enabled : def.enabled,
    };
  }
  if (!Object.values(vehicles).some((v) => v.enabled)) vehicles.Car.enabled = true;
  const surcharges = {};
  for (const [key, def] of Object.entries(DEFAULT_FEES.surcharges)) {
    const sc = (current && f.surcharges?.[key]) || {};
    surcharges[key] = { cents: cleanCents(sc.cents, def.cents), enabled: typeof sc.enabled === 'boolean' ? sc.enabled : def.enabled };
  }
  const holidays = {};
  for (const [key, def] of Object.entries(DEFAULT_FEES.holidays)) {
    holidays[key] = typeof f.holidays?.[key] === 'boolean' ? f.holidays[key] : def;
  }
  const extraHolidayDates = (Array.isArray(f.extraHolidayDates) ? f.extraHolidayDates : [])
    .filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 50);
  const addOns = {};
  for (const [key, def] of Object.entries(DEFAULT_FEES.addOns)) {
    addOns[key] = { ...def, cents: cleanCents(f.addOns?.[key]?.cents, def.cents) };
  }
  return {
    version: DEFAULT_FEES.version,
    weightTiers,
    vehicles,
    rushCents: cleanCents(current ? f.rushCents : undefined, DEFAULT_FEES.rushCents),
    surcharges,
    holidays,
    extraHolidayDates,
    maxPieceLbs: Math.max(1, cleanCents(f.maxPieceLbs, DEFAULT_FEES.maxPieceLbs)),
    extraStopCents: cleanCents(f.extraStopCents, DEFAULT_FEES.extraStopCents),
    addOns,
    waitFreeMinutes: cleanCents(f.waitFreeMinutes, DEFAULT_FEES.waitFreeMinutes),
    waitBlockMinutes: Math.max(1, cleanCents(f.waitBlockMinutes, DEFAULT_FEES.waitBlockMinutes)),
    waitBlockCents: cleanCents(f.waitBlockCents, DEFAULT_FEES.waitBlockCents),
    driverPay: {
      perJobCents: cleanCents(f.driverPay?.perJobCents, DEFAULT_FEES.driverPay.perJobCents),
      mileagePercent: Math.min(100, cleanCents(f.driverPay?.mileagePercent, DEFAULT_FEES.driverPay.mileagePercent)),
      extrasPercent: Math.min(100, cleanCents(f.driverPay?.extrasPercent, DEFAULT_FEES.driverPay.extrasPercent)),
    },
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
  return index === 0 ? `Up to ${hi} lbs` : `${lo}–${hi} lbs`;
}

// Returns why an order can't be accepted because of piece weight, or null. Also catches a total weight
// that couldn't be split into the given number of pieces without one going over the limit.
function pieceWeightProblem({ maxPieceLbs, weightLbs, pieces }, fees = DEFAULT_FEES) {
  const limit = fees.maxPieceLbs;
  const msg = `We can't take any single piece over ${limit} lbs.`;
  if (maxPieceLbs != null && Number(maxPieceLbs) > limit) return msg;
  const n = Number.parseInt(pieces, 10);
  if (weightLbs != null && n > 0 && Number(weightLbs) > n * limit) {
    return `${msg} ${Number(weightLbs).toLocaleString('en-US')} lbs in ${n} piece${n === 1 ? '' : 's'} means at least one is heavier.`;
  }
  return null;
}

const maxWeightLbs = (fees) => fees.weightTiers[fees.weightTiers.length - 1].upToLbs;

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

// Monthly business plans: each included delivery is standard service covering the first
// PLAN_LOCAL_MILES (miles beyond are per-mile); extra deliveries cost OVERAGE_CENTS, rush
// PLAN_RUSH_CENTS more. Shown on the website only when SHOW_BUSINESS_PLANS=true (hidden for now).
const BUSINESS_PLANS = {
  starter: { name: 'Starter Plan', monthlyCents: 23000, includedDeliveries: 10 },
  pro: { name: 'Pro Plan', monthlyCents: 52500, includedDeliveries: 25 },
  business: { name: 'Business Plan', monthlyCents: 95000, includedDeliveries: 50 },
};
const OVERAGE_CENTS = 2200;
const PLAN_LOCAL_MILES = 10; // miles covered by each included delivery, like the base price
const PLAN_RUSH_CENTS = 3500;
const businessPlansEnabled = () => String(process.env.SHOW_BUSINESS_PLANS || '').toLowerCase() === 'true';
// Names of plans offered before, so older plan requests still read correctly.
const PLAN_NAMES = {
  ...Object.fromEntries(Object.entries(BUSINESS_PLANS).map(([k, p]) => [k, p.name])),
  law_firm: 'Law Firm Plan', medical: 'Medical Office Plan', real_estate: 'Real Estate Plan', usc_department: 'USC Department Plan',
};

const normalizeServiceLevel = (v) => (v === 'same_day' ? 'rush' : v);
const isServiceLevel = (v) => Object.prototype.hasOwnProperty.call(SERVICE_LEVELS, normalizeServiceLevel(v));

// Local day-of-week, fractional hour and calendar date (YYYY-MM-DD) in Columbia for a given instant.
function localTime(at) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    weekday: get('weekday'),
    hour: Number(get('hour')) + Number(get('minute')) / 60,
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

// distanceMiles may be null when addresses couldn't be located; no distance fee then, and the
// quote says the distance still needs confirming.
// `at` is when the pickup happens (defaults to now); openOrders and badWeather come from the system.
// vehicleType, weightLbs, stopCount (default 2) and addOns (keys of fees.addOns) add the extras above.
// needsReview (with reviewReasons) means the formula can't price it: dispatch sets the price by hand.
function calculatePrice({
  distanceMiles, serviceLevel = 'standard', at = new Date(), openOrders = 0, badWeather = false,
  vehicleType = null, weightLbs = null, stopCount = 2, addOns = [], fees = DEFAULT_FEES,
}) {
  const level = normalizeServiceLevel(serviceLevel);
  const vehicle = fees.vehicles?.[vehicleType] || null; // unknown/legacy types: Car rates, no capacity check
  const rates = vehicle || fees.vehicles?.Car || { baseCents: BASE_FEE_CENTS, includedMiles: BASE_MILES, perMileCents: PER_MILE_CENTS };
  const miles = distanceMiles == null ? null : Math.round(Number(distanceMiles) * 10) / 10;
  const extraMiles = miles == null ? 0 : Math.max(0, Math.round((miles - rates.includedMiles) * 10) / 10);
  const extraMileageCents = Math.round(extraMiles * rates.perMileCents);
  const rushFeeCents = level === 'rush' ? fees.rushCents : 0;

  const { weekday, hour, date } = localTime(at instanceof Date ? at : new Date(at));
  const holiday = holidayName(date, fees);
  const applies = {
    holiday: !!holiday,
    weekend: (weekday === 'Sat' || weekday === 'Sun') && !(holiday && fees.surcharges.holiday.enabled),
    weather: !!badWeather,
    lunch: hour >= LUNCH_START && hour <= LUNCH_END,
    demand: openOrders >= HIGH_DEMAND_OPEN_ORDERS,
  };
  const surcharges = Object.entries(SURCHARGES)
    .filter(([key]) => applies[key] && fees.surcharges[key].enabled && fees.surcharges[key].cents > 0)
    .map(([key, s]) => ({ key, label: key === 'holiday' ? `Holiday (${holiday})` : s.label, cents: fees.surcharges[key].cents }));
  const surchargeCents = surcharges.reduce((sum, s) => sum + s.cents, 0);

  const lbs = weightLbs == null || weightLbs === '' ? null : Number(weightLbs);
  let weightFeeCents = 0;
  let weightTier = null;
  const reviewReasons = [];
  if (lbs != null && Number.isFinite(lbs)) {
    const i = fees.weightTiers.findIndex((t) => lbs <= t.upToLbs);
    if (i < 0) {
      reviewReasons.push(`Over ${maxWeightLbs(fees).toLocaleString('en-US')} lbs`);
    } else {
      weightFeeCents = fees.weightTiers[i].cents;
      weightTier = weightTierLabel(fees.weightTiers, i);
      if (vehicle && lbs > vehicle.maxLbs) {
        reviewReasons.push(`Too heavy for a ${vehicleType} (up to ${vehicle.maxLbs.toLocaleString('en-US')} lbs)`);
      }
    }
  }
  if (vehicle && !vehicle.enabled) reviewReasons.push(`${vehicleType} isn't available right now`);
  const extraStops = Math.max(0, (Number(stopCount) || 2) - 2);
  const extraStopsCents = extraStops * fees.extraStopCents;
  const addOnLines = [...new Set(addOns)].filter((k) => fees.addOns[k])
    .map((k) => ({ key: k, label: fees.addOns[k].label, cents: fees.addOns[k].cents }));
  const addOnCents = addOnLines.reduce((sum, a) => sum + a.cents, 0);

  return {
    distanceMiles: miles,
    distanceConfirmed: miles != null,
    baseFeeCents: rates.baseCents,
    baseMiles: rates.includedMiles,
    extraMiles,
    perMileCents: rates.perMileCents,
    vehicleType: vehicle ? vehicleType : null,
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
    needsReview: reviewReasons.length > 0,
    reviewReasons,
    context: { at: new Date(at).toISOString(), openOrders, badWeather: !!badWeather },
    totalCents: rates.baseCents + extraMileageCents + rushFeeCents + surchargeCents + weightFeeCents
      + extraStopsCents + addOnCents,
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
  TIME_ZONE, BASE_FEE_CENTS, BASE_MILES, PER_MILE_CENTS, RUSH_FEE_CENTS, SURCHARGES, HOLIDAYS, HIGH_DEMAND_OPEN_ORDERS,
  holidayOn, holidayName,
  VEHICLE_TYPES, SERVICE_LEVELS, BUSINESS_PLANS, OVERAGE_CENTS, PLAN_LOCAL_MILES, PLAN_RUSH_CENTS, PLAN_NAMES,
  businessPlansEnabled, DEFAULT_FEES, CHARGE_KINDS,
  normalizeFees, getFees, driverPayFor, parseWeightLbs, pieceWeightProblem, weightTierLabel, maxWeightLbs, waitCharge, normalizeServiceLevel, isServiceLevel, calculatePrice, routeMiles, pricingContext, localTime,
};
