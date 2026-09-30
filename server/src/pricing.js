// Delivery pricing, carried over from the original Choice Delivery quote page:
//   base fee covers the first 10 miles, then $1.50 per extra mile,
//   the subtotal is multiplied by a vehicle factor, and rush (2 hours or less) adds a flat $50.
// Dispatch can override the price of any order.

const BASE_FEE_CENTS = 2500;
const BASE_MILES = 10;
const PER_MILE_CENTS = 150;
const RUSH_FEE_CENTS = 5000;

// Vehicle multipliers. The original app applied one per vehicle type, but the values weren't in the
// files we have, so they start at 1.0. Change them here, e.g. 'Truck': 1.25 adds 25% for trucks.
const VEHICLE_MULTIPLIERS = {
  Car: 1.0,
  Minivan: 1.0,
  'Cargo Van': 1.0,
  Truck: 1.0,
};
const VEHICLE_TYPES = Object.keys(VEHICLE_MULTIPLIERS);

const SERVICE_LEVELS = {
  standard: { label: 'Standard delivery', description: 'Scheduled delivery', feeCents: 0 },
  rush: { label: 'Rush delivery', description: '2 hours or less', feeCents: RUSH_FEE_CENTS },
};

const BUSINESS_PLANS = {
  law_firm: { name: 'Law Firm Plan', monthlyCents: 50000, includedDeliveries: 20 },
  medical: { name: 'Medical Office Plan', monthlyCents: 30000, includedDeliveries: 15 },
  real_estate: { name: 'Real Estate Plan', monthlyCents: 40000, includedDeliveries: 18 },
  usc_department: { name: 'USC Department Plan', monthlyCents: 20000, includedDeliveries: 12 },
};
const OVERAGE_CENTS = 1500;

// Accepts the old name for rush too.
const normalizeServiceLevel = (v) => (v === 'same_day' ? 'rush' : v);
const isServiceLevel = (v) => Object.prototype.hasOwnProperty.call(SERVICE_LEVELS, normalizeServiceLevel(v));

// distanceMiles may be null when addresses couldn't be located; the base fee then applies
// and the quote says the distance still needs confirming.
function calculatePrice({ distanceMiles, serviceLevel = 'standard', vehicleType }) {
  const level = normalizeServiceLevel(serviceLevel);
  const miles = distanceMiles == null ? null : Math.round(Number(distanceMiles) * 10) / 10;
  const extraMiles = miles == null ? 0 : Math.max(0, Math.round((miles - BASE_MILES) * 10) / 10);
  const extraMileageCents = Math.round(extraMiles * PER_MILE_CENTS);
  const subtotalCents = BASE_FEE_CENTS + extraMileageCents;
  const vehicleMultiplier = VEHICLE_MULTIPLIERS[vehicleType] ?? 1;
  const vehicleAdjustmentCents = Math.round(subtotalCents * (vehicleMultiplier - 1));
  const rushFeeCents = SERVICE_LEVELS[level]?.feeCents ?? 0;
  return {
    distanceMiles: miles,
    distanceConfirmed: miles != null,
    baseFeeCents: BASE_FEE_CENTS,
    baseMiles: BASE_MILES,
    extraMiles,
    perMileCents: PER_MILE_CENTS,
    extraMileageCents,
    subtotalCents,
    vehicleType: vehicleType || null,
    vehicleMultiplier,
    vehicleAdjustmentCents,
    serviceLevel: level,
    rushFeeCents,
    totalCents: subtotalCents + vehicleAdjustmentCents + rushFeeCents,
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

module.exports = {
  BASE_FEE_CENTS, BASE_MILES, PER_MILE_CENTS, RUSH_FEE_CENTS, VEHICLE_MULTIPLIERS, VEHICLE_TYPES,
  SERVICE_LEVELS, BUSINESS_PLANS, OVERAGE_CENTS,
  normalizeServiceLevel, isServiceLevel, calculatePrice, routeMiles,
};
