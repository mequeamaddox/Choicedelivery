// Published prices (match www.choicedeliverysc.com). Dispatch can override any order's price.
const SERVICE_LEVELS = {
  standard: { label: 'Standard delivery', priceCents: 2500 },
  same_day: { label: 'Same-day (rush) delivery', priceCents: 5000 },
};

const BUSINESS_PLANS = {
  law_firm: { name: 'Law Firm Plan', monthlyCents: 50000, includedDeliveries: 20 },
  medical: { name: 'Medical Office Plan', monthlyCents: 30000, includedDeliveries: 15 },
  real_estate: { name: 'Real Estate Plan', monthlyCents: 40000, includedDeliveries: 18 },
  usc_department: { name: 'USC Department Plan', monthlyCents: 20000, includedDeliveries: 12 },
};

const OVERAGE_CENTS = 1500;

const isServiceLevel = (v) => Object.prototype.hasOwnProperty.call(SERVICE_LEVELS, v);
const defaultPriceCents = (level) => SERVICE_LEVELS[level]?.priceCents ?? SERVICE_LEVELS.standard.priceCents;

module.exports = { SERVICE_LEVELS, BUSINESS_PLANS, OVERAGE_CENTS, isServiceLevel, defaultPriceCents };
