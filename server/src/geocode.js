// Address search via OpenStreetMap Nominatim (free, no key), limited to the SC/NC/GA service area.
// Requests go through this server so we can send a proper User-Agent, cache results and stay within
// Nominatim's usage policy of at most one request per second.
const { parseLocation } = require('./util');

const USER_AGENT = 'ChoiceDelivery/1.0 (https://www.choicedeliverysc.com; info@choicedeliverysc.com)';
const STATES = { 'South Carolina': 'SC', 'North Carolina': 'NC', Georgia: 'GA' };
const HOME_BASE = { lat: 34.0007, lng: -81.0348 }; // Columbia, SC
const SERVICE_RADIUS_MILES = 200;

let fetchImpl = (...args) => fetch(...args);
const setFetch = (fn) => { fetchImpl = fn; }; // for tests

const cache = new Map();
const CACHE_MAX = 1000;
let chain = Promise.resolve();
let lastCall = 0;

// Serializes calls so we never send more than one per second.
function throttled(fn) {
  const run = chain.then(async () => {
    const wait = lastCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

function formatAddress(item) {
  const a = item.address || {};
  const state = STATES[a.state] || a.state || '';
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '';
  const street = [a.house_number, a.road].filter(Boolean).join(' ') || item.name || '';
  const line = [street, city, [state, a.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return line || item.display_name;
}

async function searchAddresses(query) {
  const q = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 200);
  if (q.length < 3) return [];
  const key = q.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  const params = new URLSearchParams({
    q, format: 'jsonv2', addressdetails: '1', limit: '8', countrycodes: 'us',
    viewbox: '-85.7,36.6,-78.5,30.3', bounded: '1', // SC plus neighbouring NC/GA
  });
  const res = await throttled(() => fetchImpl(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US' },
    signal: AbortSignal.timeout(8000),
  }));
  if (!res.ok) throw new Error(`Address lookup failed (${res.status})`);
  const data = await res.json();
  const results = data
    .filter((item) => STATES[item.address?.state])
    .map((item) => ({
      label: formatAddress(item),
      hasStreetNumber: !!item.address?.house_number,
      state: STATES[item.address.state],
      location: { lat: Number(item.lat), lng: Number(item.lon) },
    }))
    // SC first, then exact street addresses.
    .sort((x, y) => (y.state === 'SC') - (x.state === 'SC') || y.hasStreetNumber - x.hasStreetNumber)
    .slice(0, 6);

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, results);
  return results;
}

// Typed or pasted addresses often have extras the map search chokes on ("United States", a missing
// comma before the state, double spaces). Returns what to try, best first: the cleaned address, the
// street without the house number (not every house is on the map), then the ZIP code's area.
function addressVariants(address) {
  const clean = String(address || '')
    .replace(/[\r\n]+/g, ', ')
    .replace(/,?\s*(united states( of america)?|u\.?s\.?a\.?)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    // "Dr Columbia, SC" -> "Dr, Columbia, SC"; "Columbia SC 29223" -> "Columbia, SC 29223"
    .replace(/([a-z.])(?<!\bwest)\s+(West Columbia|Columbia|Lexington|Irmo|Chapin|Cayce|Blythewood|Elgin|Greer|Greenville|Spartanburg|Charleston|Florence|Sumter|Aiken|Rock Hill|Orangeburg|Camden|Newberry)(?=\s*,|\s+(SC|NC|GA)\b)/i, '$1, $2')
    .replace(/([A-Za-z.])\s+(SC|NC|GA)\b/, '$1, $2')
    .replace(/(,\s*)+/g, ', ')
    .replace(/^,\s*|,\s*$/g, '')
    .trim();
  const out = [clean];
  const noNumber = clean.replace(/^\d+[A-Za-z]?\s+/, '');
  if (noNumber !== clean) out.push(noNumber);
  const zip = clean.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] || clean.match(/\b(\d{5})\b/)?.[1];
  if (zip) out.push(zip);
  return [...new Set(out.filter((x) => x.length >= 3))];
}

// A stop's map location: the one picked from the suggestions, else the best match for the typed
// address (null when it can't be found). Quotes and orders both use this so they price the same.
async function locate(address, given) {
  const loc = parseLocation(given);
  if (loc) return loc;
  for (const q of addressVariants(address)) {
    try {
      const hit = (await searchAddresses(q))[0]?.location;
      if (hit) return hit;
    } catch { return null; }
  }
  return null;
}

// Straight-line distance in miles.
function haversineMiles(a, b) {
  const R = 3958.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = { setFetch, searchAddresses, locate, addressVariants, haversineMiles, HOME_BASE, SERVICE_RADIUS_MILES };
