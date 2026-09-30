// Integration tests. Needs a THROWAWAY Postgres database (it is wiped):
//   TEST_DATABASE_URL=postgres://... npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_DATABASE_URL) {
  test('integration tests', { skip: 'set TEST_DATABASE_URL to a throwaway database to run' }, () => {});
  return;
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = 'test-secret';
process.env.DISPATCH_API_KEY = 'test-dispatch-key';

const db = require('../src/db');
const app = require('../src/app');

let server;
let base;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

const orderBody = (extra = {}) => ({
  vehicleType: 'Van',
  weight: '20 lbs',
  numberOfPieces: '2',
  stops: [
    { type: 'pickup', address: '1 Main St', contactName: 'Warehouse', location: { lat: 34, lng: -81 } },
    { type: 'dropoff', address: '2 Oak Ave', contactName: 'Jane', contactPhone: '555' },
  ],
  ...extra,
});

const t = {}; // tokens
const ids = {};

before(async () => {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.pool.end();
});

test('first account becomes admin; later registration needs staff', async () => {
  let r = await call('POST', '/auth/register', { body: { email: 'Admin@Test.com', password: 'password1', name: 'Ada' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'admin');
  t.admin = r.data.token;

  r = await call('POST', '/auth/register', { body: { email: 'x@test.com', password: 'password1' } });
  assert.equal(r.status, 401);

  r = await call('POST', '/auth/register', { token: t.admin, body: { email: 'disp@test.com', password: 'password1', role: 'dispatcher' } });
  assert.equal(r.status, 201);
  t.dispatcher = (await call('POST', '/auth/login', { body: { email: 'disp@test.com', password: 'password1' } })).data.token;

  for (const n of ['d1', 'd2']) {
    r = await call('POST', '/auth/register', { token: t.dispatcher, body: { email: `${n}@test.com`, password: 'password1', name: n } });
    assert.equal(r.status, 201);
    ids[n] = r.data.user.id;
    t[n] = (await call('POST', '/auth/login', { body: { email: `${n}@test.com`, password: 'password1' } })).data.token;
  }

  r = await call('POST', '/auth/register', { token: t.dispatcher, body: { email: 'a2@test.com', password: 'password1', role: 'admin' } });
  assert.equal(r.status, 403, 'dispatchers cannot create admins');
  r = await call('POST', '/auth/register', { token: t.d1, body: { email: 'z@test.com', password: 'password1' } });
  assert.equal(r.status, 403, 'drivers cannot create accounts');
});

test('shipper self-signup creates a company; coworkers can be added', async () => {
  let r = await call('POST', '/auth/signup', { body: { companyName: 'Acme Supply', name: 'Sam', email: 'sam@acme.com', password: 'password1' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'shipper');
  assert.equal(r.data.user.organization.name, 'Acme Supply');
  t.acme = r.data.token;
  ids.acmeOrg = r.data.user.organization.id;

  r = await call('POST', '/auth/signup', { body: { companyName: 'Other Co', email: 'o@other.com', password: 'password1' } });
  t.other = r.data.token;

  r = await call('POST', `/organizations/${ids.acmeOrg}/users`, { token: t.acme, body: { email: 'pat@acme.com', password: 'password1' } });
  assert.equal(r.status, 201);
  r = await call('POST', `/organizations/${ids.acmeOrg}/users`, { token: t.other, body: { email: 'evil@other.com', password: 'password1' } });
  assert.equal(r.status, 404, 'other companies cannot add users to Acme');
});

test('order validation', async () => {
  let r = await call('POST', '/orders', { token: t.acme, body: { stops: [{ type: 'pickup', address: 'a' }] } });
  assert.equal(r.status, 400);
  r = await call('POST', '/orders', { token: t.acme, body: orderBody({ stops: [
    { type: 'dropoff', address: 'a' }, { type: 'pickup', address: 'b' }] }) });
  assert.equal(r.status, 400);
  r = await call('POST', '/orders', { token: t.acme, body: orderBody({ priceCents: 100 }) });
  assert.equal(r.status, 403, 'shippers cannot set prices');
  r = await call('POST', '/orders', { token: t.d1, body: orderBody() });
  assert.equal(r.status, 403, 'drivers cannot create orders');
});

test('full delivery flow with shipper visibility and tracking', async () => {
  let r = await call('POST', '/orders', { token: t.acme, body: orderBody({ trackingNumber: 'TRK-1' }) });
  assert.equal(r.status, 201);
  const order = r.data;
  ids.order = order.id;
  assert.match(order.orderNumber, /^CD-\d+$/);
  assert.equal(order.status, 'pending');
  assert.equal(order.organization.id, ids.acmeOrg);
  assert.ok(order.trackingUrlToken);

  r = await call('GET', `/orders/${order.id}`, { token: t.other });
  assert.equal(r.status, 404, 'other shippers cannot see it');
  r = await call('GET', '/orders', { token: t.other });
  assert.equal(r.data.length, 0);

  r = await call('GET', '/orders?status=pending', { token: t.d2 });
  assert.ok(r.data.some((o) => o.id === order.id), 'drivers see open jobs');

  const [a, b] = await Promise.all([
    call('POST', `/orders/${order.id}/accept`, { token: t.d1 }),
    call('POST', `/orders/${order.id}/accept`, { token: t.d2 }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], 'only one driver wins');
  const winner = a.status === 200 ? 'd1' : 'd2';
  const loser = winner === 'd1' ? 'd2' : 'd1';
  ids.winner = winner;

  r = await call('GET', `/orders/${order.id}`, { token: t[loser] });
  assert.equal(r.status, 404, "the other driver can no longer see it");

  const [pickup, dropoff] = order.stops;
  r = await call('POST', `/orders/${order.id}/stops/${dropoff.id}/arrive`, { token: t[winner] });
  assert.equal(r.status, 409, 'stops must go in order');

  r = await call('POST', `/orders/${order.id}/stops/${pickup.id}/arrive`, { token: t[winner] });
  assert.equal(r.data.status, 'at_pickup');

  r = await call('POST', `/orders/${order.id}/stops/${pickup.id}/complete`, { token: t[winner], body: {} });
  assert.equal(r.status, 400, 'proof is required');
  r = await call('POST', `/orders/${order.id}/stops/${pickup.id}/complete`, { token: t[winner], body: { signature: 'data:image/png;base64,AA' } });
  assert.equal(r.data.status, 'in_transit');

  await call('PUT', '/users/me/location', { token: t[winner], body: { lat: 34.01, lng: -81.02 } });
  r = await call('GET', `/orders/${order.id}`, { token: t.acme });
  assert.deepEqual(r.data.driver.location, { lat: 34.01, lng: -81.02 }, 'shipper sees live driver location');
  r = await call('GET', `/track/${order.trackingUrlToken}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'in_transit');
  assert.ok(r.data.driver.location);
  assert.equal(r.data.stops[0].signature, undefined, 'public tracking hides proof');

  r = await call('POST', `/orders/${order.id}/cancel`, { token: t.acme });
  assert.equal(r.status, 409, 'shippers cannot cancel once underway');

  r = await call('POST', `/orders/${order.id}/stops/${dropoff.id}/complete`, { token: t[winner], body: { photo: 'data:image/jpeg;base64,AA', printedName: 'Jane' } });
  assert.equal(r.data.status, 'completed');
  assert.ok(r.data.completedAt);
  assert.deepEqual(r.data.events.map((e) => e.type),
    ['created', 'accepted', 'stop_arrived', 'stop_completed', 'stop_completed', 'completed']);

  r = await call('GET', '/orders?mine=true&status=completed', { token: t[winner] });
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].stops[1].signature, undefined, 'lists omit heavy proof data');
  assert.equal(r.data[0].stops[1].hasPhoto, true);
});

test('dispatch assigns, reassigns and unassigns; shipper cancels pending orders', async () => {
  let r = await call('POST', '/orders', { token: 'test-dispatch-key', body: orderBody({ organizationId: ids.acmeOrg, priceCents: 4500 }) });
  assert.equal(r.status, 201, 'integration key can create orders');
  const id = r.data.id;

  r = await call('POST', `/orders/${id}/assign`, { token: t.dispatcher, body: { driverId: ids.d2 } });
  assert.equal(r.data.status, 'accepted');
  assert.equal(r.data.driver.id, ids.d2);
  r = await call('POST', `/orders/${id}/assign`, { token: t.dispatcher, body: { driverId: null } });
  assert.equal(r.data.status, 'pending');
  assert.equal(r.data.driver, null);

  r = await call('POST', `/orders/${id}/assign`, { token: t.acme, body: { driverId: ids.d1 } });
  assert.equal(r.status, 403);

  r = await call('PATCH', `/orders/${id}`, { token: t.acme, body: { description: 'Fragile' } });
  assert.equal(r.data.description, 'Fragile');

  r = await call('POST', `/orders/${id}/cancel`, { token: t.acme, body: { reason: 'changed mind' } });
  assert.equal(r.data.status, 'cancelled');
  r = await call('POST', `/orders/${id}/accept`, { token: t.d1 });
  assert.equal(r.status, 409);
});

test('barcode scan picks up the matching shipment', async () => {
  let r = await call('POST', '/orders', { token: t.acme, body: orderBody({ trackingNumber: 'SCAN-9' }) });
  const id = r.data.id;
  r = await call('POST', '/orders/scan', { token: t.d1, body: { barcode: 'SCAN-9' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'in_transit');
  assert.equal(r.data.driver.id, ids.d1);
  r = await call('POST', '/orders/scan', { token: t.d1, body: { barcode: 'SCAN-9' } });
  assert.equal(r.status, 409, 'cannot scan twice');
  r = await call('POST', '/orders/scan', { token: t.d2, body: { barcode: 'TRK-1' } });
  assert.equal(r.status, 404, "cannot scan another driver's shipment");
  await call('POST', `/orders/${id}/cancel`, { token: t.admin });
});

test('profiles, vehicles, availability and staff views', async () => {
  let r = await call('PUT', '/users/me', { token: t.d1, body: { phoneNumber: '803', vehicleType: 'Box Truck' } });
  assert.equal(r.data.vehicleType, 'Box Truck');
  r = await call('PUT', '/users/me', { token: t.d1, body: { vehicleType: 'Cargo Van' } });
  assert.equal(r.data.vehicleType, 'Cargo Van', 'updates the same vehicle');
  await call('PUT', '/users/me/availability', { token: t.d1, body: { online: true } });

  r = await call('GET', '/users?role=driver&online=true', { token: t.dispatcher });
  assert.deepEqual(r.data.map((u) => u.email), ['d1@test.com']);
  r = await call('GET', '/users', { token: t.acme });
  assert.equal(r.status, 403);
  r = await call('PUT', '/users/me/location', { token: t.acme, body: { lat: 1, lng: 1 } });
  assert.equal(r.status, 403, 'only drivers report location');
});

test('deactivated accounts are locked out immediately', async () => {
  let r = await call('PATCH', `/users/${ids.d2}`, { token: t.dispatcher, body: { isActive: false } });
  assert.equal(r.data.isActive, false);
  r = await call('GET', '/users/me', { token: t.d2 });
  assert.equal(r.status, 401);
  r = await call('POST', '/auth/login', { body: { email: 'd2@test.com', password: 'password1' } });
  assert.equal(r.status, 403);
  r = await call('PATCH', `/users/${ids.d2}`, { token: t.dispatcher, body: { role: 'admin' } });
  assert.equal(r.status, 403, 'dispatchers cannot promote');
});

test('password reset', async () => {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    await call('POST', '/auth/forgot-password', { body: { email: 'd1@test.com' } });
  } finally {
    console.log = orig;
  }
  const token = logs.join('\n').match(/#\/reset\/([0-9a-f]+)/)[1];
  let r = await call('POST', '/auth/reset-password', { body: { token, password: 'brandnew1' } });
  assert.equal(r.status, 200);
  r = await call('POST', '/auth/reset-password', { body: { token, password: 'brandnew2' } });
  assert.equal(r.status, 400, 'tokens are single use');
  r = await call('POST', '/auth/login', { body: { email: 'd1@test.com', password: 'brandnew1' } });
  assert.equal(r.status, 200);
  const res = await fetch(`${base}/reset-password?token=abc123`, { redirect: 'manual' });
  assert.equal(res.headers.get('location'), '/#/reset/abc123', 'old links redirect into the web app');
});

test('change password', async () => {
  let r = await call('POST', '/auth/change-password', { token: t.acme, body: { currentPassword: 'wrong', newPassword: 'whatever1' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/auth/change-password', { token: t.acme, body: { currentPassword: 'password1', newPassword: 'password2' } });
  assert.equal(r.status, 200);
  r = await call('POST', '/auth/login', { body: { email: 'sam@acme.com', password: 'password2' } });
  assert.equal(r.status, 200);
});

test('web app is served with security headers', async () => {
  let res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /html/);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await res.text(), /static\/main\.js/);
  res = await fetch(`${base}/static/main.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  res = await fetch(`${base}/static/../src/db.js`);
  assert.notEqual(res.status, 200);
  res = await fetch(`${base}/static/nope.js`);
  assert.equal(res.status, 404);
});

test('pricing formula matches the original shared/pricing.ts', () => {
  const { calculatePrice } = require('../src/pricing');
  const wedMorning = new Date('2026-09-30T14:00:00Z'); // 10:00 in Columbia
  const wedLunch = new Date('2026-09-30T16:15:00Z'); // 12:15
  const saturday = new Date('2026-10-03T13:00:00Z'); // Sat 09:00
  const price = (o) => calculatePrice({ at: wedMorning, ...o });
  assert.equal(price({ distanceMiles: 3 }).totalCents, 2500, 'first 5 miles are the base fee');
  assert.equal(price({ distanceMiles: 5 }).totalCents, 2500);
  assert.equal(price({ distanceMiles: 12 }).totalCents, 3550, '$25 + 7 mi x $1.50');
  assert.equal(price({ distanceMiles: 12, serviceLevel: 'rush' }).totalCents, 8550, 'rush adds $50');
  assert.equal(price({ distanceMiles: 12, serviceLevel: 'same_day' }).rushFeeCents, 5000, 'old name still works');
  assert.equal(price({ distanceMiles: null }).distanceConfirmed, false);
  assert.deepEqual(calculatePrice({ distanceMiles: 3, at: wedLunch }).surcharges.map((x) => x.key), ['lunch']);
  assert.equal(calculatePrice({ distanceMiles: 3, at: wedLunch }).totalCents, 3000, 'lunch rush +$5');
  assert.equal(calculatePrice({ distanceMiles: 3, at: saturday }).totalCents, 3500, 'weekend +$10');
  assert.equal(price({ distanceMiles: 3, openOrders: 2 }).totalCents, 2500);
  assert.equal(price({ distanceMiles: 3, openOrders: 3 }).totalCents, 4000, 'high demand +$15 at 3 open orders');
  assert.equal(price({ distanceMiles: 3, badWeather: true }).totalCents, 4000, 'bad weather +$15');
  const all = calculatePrice({ distanceMiles: 12, serviceLevel: 'rush', at: saturday, openOrders: 5, badWeather: true });
  assert.equal(all.totalCents, 2500 + 1050 + 5000 + 1000 + 1500 + 1500);
});

test('orders are priced on the server by distance; dispatch can override', async () => {
  const far = orderBody({ stops: [
    { type: 'pickup', address: 'Columbia', location: { lat: 34.0007, lng: -81.0348 } },
    { type: 'dropoff', address: 'Charleston', location: { lat: 32.7765, lng: -79.9311 } },
  ] });
  const surchargeTotal = (b) => b.surcharges.reduce((sum, x) => sum + x.cents, 0);
  let r = await call('POST', '/orders', { token: t.acme, body: far });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const miles = r.data.distanceMiles;
  assert.ok(miles > 100 && miles < 160, `distance ${miles}`);
  const bd = r.data.priceBreakdown;
  assert.equal(bd.extraMileageCents, Math.round((miles - 5) * 150));
  assert.equal(r.data.priceCents, 2500 + bd.extraMileageCents + surchargeTotal(bd));
  assert.equal(r.data.priceIsCustom, false);
  const id = r.data.id;

  // Turning on bad weather affects new orders only.
  r = await call('PUT', '/settings/bad-weather', { token: t.acme, body: { enabled: true } });
  assert.equal(r.status, 403, 'only dispatch can switch weather pricing');
  await call('PUT', '/settings/bad-weather', { token: t.dispatcher, body: { enabled: true } });
  r = await call('POST', '/public/quote', { body: { stops: far.stops } });
  assert.ok(r.data.surcharges.some((x) => x.key === 'weather'), 'quotes include weather while on');

  r = await call('PATCH', `/orders/${id}`, { token: t.acme, body: { serviceLevel: 'rush' } });
  assert.equal(r.data.priceBreakdown.rushFeeCents, 5000, 'switching to rush reprices');
  assert.ok(!r.data.priceBreakdown.surcharges.some((x) => x.key === 'weather'), 'booking-time conditions are kept');
  assert.equal(r.data.priceCents, r.data.priceBreakdown.totalCents);
  await call('PUT', '/settings/bad-weather', { token: t.dispatcher, body: { enabled: false } });

  r = await call('POST', '/orders', { token: t.acme, body: orderBody({ serviceLevel: 'teleport' }) });
  assert.equal(r.status, 400);
  r = await call('POST', '/orders', { token: t.acme, body: orderBody() });
  assert.equal(r.data.priceCents, 2500 + surchargeTotal(r.data.priceBreakdown), 'without map locations no distance fee');
  assert.equal(r.data.distanceMiles, null);
  await call('POST', `/orders/${r.data.id}/cancel`, { token: t.admin });

  r = await call('PATCH', `/orders/${id}`, { token: t.dispatcher, body: { priceCents: 9900 } });
  assert.equal(r.data.priceCents, 9900);
  assert.equal(r.data.priceIsCustom, true);
  r = await call('PATCH', `/orders/${id}`, { token: t.dispatcher, body: { description: 'edited' } });
  assert.equal(r.data.priceCents, 9900, 'custom price survives other edits');
  r = await call('PATCH', `/orders/${id}`, { token: t.dispatcher, body: { priceCents: null } });
  assert.equal(r.data.priceIsCustom, false, 'clearing the price returns to the formula');
  assert.equal(r.data.priceCents, r.data.priceBreakdown.totalCents);
  await call('POST', `/orders/${id}/cancel`, { token: t.admin });
});

test('website: contact messages and plan requests become leads', async () => {
  let r = await call('GET', '/public/pricing');
  assert.equal(r.data.businessPlans.length, 4);

  r = await call('POST', '/public/contact', { body: { firstName: 'Jo', lastName: 'Ray', email: 'jo@x.com', message: 'Need weekly runs' } });
  assert.equal(r.status, 201);
  r = await call('POST', '/public/contact', { body: { firstName: 'Jo', email: 'not-an-email', message: 'x' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/public/contact', { body: { firstName: 'Bot', email: 'b@x.com', message: 'spam', website: 'http://spam' } });
  assert.equal(r.status, 201, 'honeypot submissions look accepted');
  r = await call('POST', '/public/contract-request', { body: { plan: 'law_firm', name: 'Ann', company: 'Smith Law', email: 'ann@smith.law' } });
  assert.equal(r.status, 201);
  r = await call('POST', '/public/contract-request', { body: { plan: 'free_stuff', name: 'A', email: 'a@b.co' } });
  assert.equal(r.status, 400);

  r = await call('GET', '/leads', { token: t.acme });
  assert.equal(r.status, 403, 'shippers cannot see leads');
  r = await call('GET', '/leads?status=new', { token: t.dispatcher });
  assert.deepEqual(r.data.map((l) => l.type).sort(), ['contact', 'contract'], 'spam was dropped');
  const contract = r.data.find((l) => l.type === 'contract');
  assert.equal(contract.planName, 'Law Firm Plan');
  r = await call('PATCH', `/leads/${contract.id}`, { token: t.dispatcher, body: { status: 'contacted' } });
  assert.equal(r.data.status, 'contacted');
});

test('address suggestions and distance-aware quotes', async () => {
  const geocode = require('../src/geocode');
  const places = {
    'columbia': { lat: '34.0007', lon: '-81.0348', address: { house_number: '1515', road: 'Manning Ave', city: 'Columbia', state: 'South Carolina', postcode: '29203' } },
    'charleston': { lat: '32.7765', lon: '-79.9311', address: { road: 'King St', city: 'Charleston', state: 'South Carolina' } },
    'atlanta': { lat: '33.749', lon: '-84.388', address: { city: 'Atlanta', state: 'Georgia' } },
    'nashville': { lat: '36.16', lon: '-86.78', address: { city: 'Nashville', state: 'Tennessee' } },
    'miami': { lat: '25.76', lon: '-80.19', address: { city: 'Miami', state: 'Florida' } },
  };
  let calls = 0;
  geocode.setFetch(async (url) => {
    calls++;
    const q = new URL(url).searchParams.get('q').toLowerCase();
    const hits = Object.entries(places).filter(([k]) => q.includes(k)).map(([, v]) => v);
    return { ok: true, json: async () => hits };
  });

  let r = await call('GET', '/public/geocode?q=1515%20Manning%20Ave%20columbia');
  assert.equal(r.data[0].label, '1515 Manning Ave, Columbia, SC 29203');
  assert.deepEqual(r.data[0].location, { lat: 34.0007, lng: -81.0348 });
  r = await call('GET', '/public/geocode?q=Nashville');
  assert.equal(r.data.length, 0, 'outside SC/NC/GA is filtered out');
  const before = calls;
  await call('GET', '/public/geocode?q=1515%20Manning%20Ave%20columbia');
  assert.equal(calls, before, 'repeat lookups are cached');

  r = await call('POST', '/public/quote', { body: { pickupAddress: 'columbia', dropoffAddress: 'charleston', serviceLevel: 'rush',
    scheduledAt: '2026-09-30T14:00:00Z' } });
  assert.ok(r.data.distanceMiles > 100 && r.data.distanceMiles < 160, `distance ${r.data.distanceMiles}`);
  const demand = r.data.surcharges.reduce((sum, x) => sum + x.cents, 0);
  assert.equal(r.data.totalCents, 2500 + Math.round((r.data.distanceMiles - 5) * 150) + 5000 + demand);
  assert.equal(r.data.priceCents, r.data.totalCents);
  assert.equal(r.data.outOfArea, false);
  r = await call('POST', '/public/quote', { body: { pickupAddress: 'columbia', dropoffAddress: 'x',
    dropoffLocation: { lat: 25.76, lng: -80.19 } } });
  assert.equal(r.data.outOfArea, true, 'Miami is beyond 200 miles');

  geocode.setFetch(async () => ({ ok: false, status: 503 }));
  r = await call('GET', '/public/geocode?q=somewhere%20new');
  assert.equal(r.status, 502, 'lookup outages degrade gracefully');
});

test('landing page is served on www; the app on other hosts', async () => {
  const http = require('http');
  const get = (host, p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: p, headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
  let r = await get('choicedeliverysc.com', '/');
  assert.equal(r.status, 200);
  assert.match(r.body, /Your Choice, Our Priority/);
  r = await get('choicedeliverysc.com', '/privacy');
  assert.match(r.body, /Privacy Policy/);
  r = await get('choicedeliverysc.com', '/logo.png');
  assert.match(r.headers['content-type'], /image\/png/);
  r = await get('www.choicedeliverysc.com', '/privacy.html');
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, 'https://choicedeliverysc.com/privacy.html');
  r = await get('choicedeliverysc.com', '/public/pricing');
  assert.equal(r.status, 200, 'API still reachable from the landing host');
  r = await get('app.choicedeliverysc.com', '/');
  assert.match(r.body, /static\/main\.js/, 'app host gets the web app');
  r = await get('app.choicedeliverysc.com', '/health');
  assert.equal(r.status, 200, 'the driver app uses app.choicedeliverysc.com for the API');
});

test('Neon connection strings are cleaned without corrupting the database name', () => {
  const { cleanConnectionString } = require('../src/db');
  assert.equal(
    cleanConnectionString('postgresql://u:p@ep-x.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'),
    'postgresql://u:p@ep-x.us-east-2.aws.neon.tech/neondb');
  assert.equal(cleanConnectionString('postgres://u:p@h:5432/db?application_name=cd&sslmode=require'),
    'postgres://u:p@h:5432/db?application_name=cd');
  assert.throws(() => cleanConnectionString('not a url'), /not a valid/);
});

test('setup status flips once the owner account exists', async () => {
  const r = await call('GET', '/auth/setup-status');
  assert.equal(r.data.needsSetup, false, 'accounts already exist in this test run');
});

test('demo data: admin-only, invisible to real drivers, removable without touching real data', async () => {
  const countReal = async () => (await db.query('SELECT count(*)::int n FROM orders WHERE NOT is_demo')).rows[0].n;
  const realBefore = await countReal();
  const openBefore = (await require('../src/pricing').pricingContext(db)).openOrders;

  let r = await call('POST', '/demo', { token: t.dispatcher });
  assert.equal(r.status, 403, 'only admins can load demo data');
  r = await call('POST', '/demo', { token: t.admin });
  assert.equal(r.status, 201);
  assert.ok(r.data.orders >= 8 && r.data.companies === 3 && r.data.leads === 2, JSON.stringify(r.data));

  r = await call('GET', '/orders?limit=500', { token: t.admin });
  const demo = r.data.filter((o) => o.isDemo);
  assert.ok(demo.length >= 8, 'admins see demo orders');
  assert.ok(demo.some((o) => o.status === 'completed' && o.stops.every((s) => s.hasSignature)), 'completed demo has proof');
  const pendingDemo = demo.find((o) => o.status === 'pending');
  assert.ok(demo.every((o) => o.orderNumber.startsWith('DEMO-')), 'demo orders do not use real order numbers');

  r = await call('GET', '/orders?status=pending', { token: t.d1 });
  assert.ok(!r.data.some((o) => o.isDemo), 'real drivers never see demo jobs');
  r = await call('POST', `/orders/${pendingDemo.id}/accept`, { token: t.d1 });
  assert.equal(r.status, 409, 'real drivers cannot accept demo jobs');
  r = await call('POST', `/orders/${pendingDemo.id}/assign`, { token: t.dispatcher, body: { driverId: ids.d1 } });
  assert.equal(r.status, 400, 'dispatch cannot put a real driver on a demo job');

  assert.equal((await require('../src/pricing').pricingContext(db)).openOrders, openBefore, 'demo orders do not trigger surge pricing');
  r = await call('GET', '/users?role=driver', { token: t.admin });
  assert.equal(r.data.filter((u) => u.isDemo).length, 3);
  r = await call('POST', '/auth/login', { body: { email: r.data.find((u) => u.isDemo).email, password: 'password1' } });
  assert.equal(r.status, 401, 'demo accounts cannot log in');

  r = await call('POST', '/demo', { token: t.admin });
  assert.equal(r.data.companies, 3, 'loading again replaces instead of duplicating');

  r = await call('DELETE', '/demo', { token: t.admin });
  assert.equal(r.status, 200);
  r = await call('GET', '/demo', { token: t.admin });
  assert.equal(r.data.loaded, false);
  assert.equal(await countReal(), realBefore, 'real orders untouched');
});

test('payments: card orders wait for Stripe payment; invoice companies dispatch immediately; cancel refunds', async () => {
  const stripe = require('../src/stripe');
  const crypto = require('crypto');
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const stripeCalls = [];
  stripe.setFetch(async (url, opts) => {
    const body = new URLSearchParams(opts.body || '');
    stripeCalls.push({ url, body });
    if (url.endsWith('/checkout/sessions')) {
      return { ok: true, json: async () => ({ id: `cs_${stripeCalls.length}`, url: 'https://checkout.stripe.com/pay/cs_test' }) };
    }
    if (url.includes('/expire')) return { ok: true, json: async () => ({}) };
    if (url.endsWith('/refunds')) return { ok: true, json: async () => ({ id: 're_1', amount: Number(body.get('amount')) }) };
    return { ok: false, status: 404, json: async () => ({ error: { message: 'unexpected' } }) };
  });
  const webhook = (event, secret = 'whsec_test') => {
    const payload = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
    return fetch(`${base}/webhooks/stripe`, { method: 'POST', body: payload,
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${ts},v1=${sig}` } });
  };

  try {
    let r = await call('GET', '/payments/config');
    assert.equal(r.data.enabled, true);
    r = await call('POST', '/orders', { token: t.acme, body: orderBody() });
    const order = r.data;
    assert.equal(order.paymentStatus, 'unpaid', 'card customers pay first');
    r = await call('GET', '/orders?status=pending', { token: t.d1 });
    assert.ok(!r.data.some((o) => o.id === order.id), 'drivers do not see unpaid jobs');
    r = await call('POST', `/orders/${order.id}/accept`, { token: t.d1 });
    assert.equal(r.status, 409);

    r = await call('POST', `/orders/${order.id}/checkout`, { token: t.acme });
    assert.equal(r.data.url, 'https://checkout.stripe.com/pay/cs_test');
    const sent = stripeCalls.find((c) => c.url.endsWith('/checkout/sessions')).body;
    assert.equal(sent.get('line_items[0][price_data][unit_amount]'), String(order.priceCents), 'charges the order price');
    assert.equal(sent.get('metadata[order_id]'), order.id);
    const sessionId = (await db.query('SELECT stripe_session_id FROM orders WHERE id = $1', [order.id])).rows[0].stripe_session_id;

    const paidEvent = { type: 'checkout.session.completed', data: { object: {
      id: sessionId, payment_status: 'paid', amount_total: order.priceCents, payment_intent: 'pi_123',
      metadata: { order_id: order.id } } } };
    let res = await webhook(paidEvent, 'wrong_secret');
    assert.equal(res.status, 400, 'forged webhooks are rejected');
    res = await webhook(paidEvent);
    assert.equal(res.status, 200);
    await webhook(paidEvent); // Stripe retries are harmless
    r = await call('GET', `/orders/${order.id}`, { token: t.acme });
    assert.equal(r.data.paymentStatus, 'paid');
    assert.equal(r.data.paidCents, order.priceCents);
    assert.equal(r.data.events.filter((e) => e.type === 'paid').length, 1, 'recorded once');
    r = await call('GET', '/orders?status=pending', { token: t.d1 });
    assert.ok(r.data.some((o) => o.id === order.id), 'paid job is now visible to drivers');

    r = await call('PATCH', `/orders/${order.id}`, { token: t.acme, body: { serviceLevel: 'rush' } });
    assert.equal(r.status, 409, 'paid orders cannot be repriced by the shipper');

    r = await call('POST', `/orders/${order.id}/cancel`, { token: t.acme });
    assert.equal(r.data.paymentStatus, 'refunded');
    assert.equal(r.data.refundedCents, order.priceCents);
    const refundCall = stripeCalls.find((c) => c.url.endsWith('/refunds'));
    assert.equal(refundCall.body.get('payment_intent'), 'pi_123');

    // Invoice (monthly account) companies skip payment.
    await call('PATCH', `/organizations/${ids.acmeOrg}`, { token: t.acme, body: { billingMode: 'invoice' } })
      .then((x) => assert.equal(x.status, 403, 'shippers cannot switch themselves to invoicing'));
    await call('PATCH', `/organizations/${ids.acmeOrg}`, { token: t.dispatcher, body: { billingMode: 'invoice' } });
    r = await call('POST', '/orders', { token: t.acme, body: orderBody() });
    assert.equal(r.data.paymentStatus, 'invoice');
    const inv = r.data.id;
    r = await call('POST', `/orders/${inv}/checkout`, { token: t.acme });
    assert.equal(r.status, 409);
    r = await call('POST', `/orders/${inv}/payment`, { token: t.dispatcher, body: { status: 'paid', method: 'check' } });
    assert.equal(r.data.paymentStatus, 'paid');
    assert.equal(r.data.paymentMethod, 'check');
    r = await call('POST', `/orders/${inv}/payment`, { token: t.acme, body: { status: 'waived' } });
    assert.equal(r.status, 403, 'only dispatch records payments');
    await call('POST', `/orders/${inv}/cancel`, { token: t.admin });
    await call('PATCH', `/organizations/${ids.acmeOrg}`, { token: t.dispatcher, body: { billingMode: 'card' } });
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }
});

test('shippers get status emails with a tracking link; opt-out and demo respected', async () => {
  const mailer = require('../src/mailer');
  const sent = [];
  mailer.setSender(async (m) => { sent.push(m); });
  const settle = () => new Promise((r) => setTimeout(r, 150));
  try {
    const shipperEmail = (await call('GET', '/users/me', { token: t.acme })).data.email;
    let r = await call('POST', '/orders', { token: t.acme, body: orderBody() });
    const order = r.data;
    await settle();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, shipperEmail);
    assert.match(sent[0].subject, /booked/);
    assert.ok(sent[0].html.includes(`#/track/${order.trackingUrlToken}`), 'includes the tracking link');

    await call('POST', `/orders/${order.id}/accept`, { token: t.d1 });
    await call('POST', `/orders/${order.id}/stops/${order.stops[0].id}/complete`, { token: t.d1, body: { signature: 'data:x' } });
    await call('POST', `/orders/${order.id}/stops/${order.stops[1].id}/complete`, { token: t.d1, body: { photo: 'data:y', printedName: 'Jane <Q>' } });
    await settle();
    assert.deepEqual(sent.map((m) => m.subject.split(/[:\s]/)[0]), ['Order', 'A', 'Picked', 'Delivered']);
    assert.ok(sent[3].html.includes('Jane &lt;Q&gt;'), 'names are escaped');

    await call('PUT', '/users/me', { token: t.acme, body: { emailUpdates: false } });
    sent.length = 0;
    r = await call('POST', '/orders', { token: t.acme, body: orderBody() });
    await call('POST', `/orders/${r.data.id}/cancel`, { token: t.admin });
    await settle();
    assert.equal(sent.length, 0, 'opted-out shippers get no emails');
    await call('PUT', '/users/me', { token: t.acme, body: { emailUpdates: true } });

    r = await call('POST', '/orders', { token: t.acme, body: orderBody() });
    await settle();
    sent.length = 0;
    await call('POST', `/orders/${r.data.id}/cancel`, { token: t.admin });
    await settle();
    assert.deepEqual(sent.map((m) => m.subject), [`Order ${r.data.orderNumber} cancelled`], 'dispatch cancellations are emailed');

    sent.length = 0;
    await call('POST', '/demo', { token: t.admin });
    await call('DELETE', '/demo', { token: t.admin });
    r = await call('POST', '/orders', { token: t.dispatcher, body: orderBody({ organizationId: ids.acmeOrg }) });
    await call('POST', `/orders/${r.data.id}/cancel`, { token: t.admin });
    await settle();
    assert.equal(sent.length, 0, 'no emails for demo data or dispatch-booked orders');
  } finally {
    mailer.setSender(null);
  }
});

test('stripe webhook is created automatically and its secret is kept private', async () => {
  const stripe = require('../src/stripe');
  const crypto = require('crypto');
  process.env.STRIPE_SECRET_KEY = 'sk_test_auto';
  process.env.PUBLIC_URL = 'https://app.choicedeliverysc.com';
  delete process.env.STRIPE_WEBHOOK_SECRET;
  const calls = [];
  stripe.setFetch(async (url, opts) => {
    calls.push(`${opts.method} ${url.replace('https://api.stripe.com/v1', '')}`);
    if (opts.method === 'GET') return { ok: true, json: async () => ({ data: [{ id: 'we_old', url: 'https://app.choicedeliverysc.com/webhooks/stripe' }] }) };
    if (opts.method === 'DELETE') return { ok: true, json: async () => ({ deleted: true }) };
    return { ok: true, json: async () => ({ id: 'we_new', secret: 'whsec_auto123' }) };
  });
  try {
    let r = await stripe.ensureWebhook(db);
    assert.equal(r.status, 'created');
    assert.deepEqual(calls, ['GET /webhook_endpoints?limit=100', 'DELETE /webhook_endpoints/we_old', 'POST /webhook_endpoints']);
    r = await stripe.ensureWebhook(db);
    assert.equal(r.status, 'ready', 'second start reuses the saved endpoint');
    assert.equal(calls.length, 3);

    const cfg = await call('GET', '/payments/config');
    assert.deepEqual(cfg.data, { enabled: true, mode: 'test', webhookReady: true });
    const settings = await call('GET', '/settings', { token: t.admin });
    assert.ok(!('stripe_webhook' in settings.data), 'signing secret never exposed');

    const payload = JSON.stringify({ type: 'ping', data: { object: {} } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_auto123').update(`${ts}.${payload}`).digest('hex');
    const res = await fetch(`${base}/webhooks/stripe`, { method: 'POST', body: payload,
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${ts},v1=${sig}` } });
    assert.equal(res.status, 200, 'webhooks verify with the automatically stored secret');

    process.env.STRIPE_SECRET_KEY = 'sk_live_now';
    r = await stripe.ensureWebhook(db);
    assert.equal(r.status, 'created', 'switching to live keys registers a live webhook');
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.PUBLIC_URL;
  }
});

test('saved quotes: hidden from drivers, booked later at a rechecked price, deletable', async () => {
  const stripe = require('../src/stripe');
  const mailer = require('../src/mailer');
  const sent = [];
  mailer.setSender(async (m) => { sent.push(m); });
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  stripe.setFetch(async () => ({ ok: true, json: async () => ({ id: 'cs_q', url: 'https://checkout.stripe.com/pay/cs_q' }) }));
  const settle = () => new Promise((r) => setTimeout(r, 150));
  try {
    let r = await call('POST', '/orders', { token: t.acme, body: orderBody({ saveAsQuote: true }) });
    assert.equal(r.status, 201);
    const quote = r.data;
    assert.equal(quote.status, 'quote');
    assert.equal(quote.bookedAt, null);
    assert.ok(quote.priceCents > 0, 'quotes are priced');
    assert.equal(quote.trackingUrlToken, undefined, 'quotes have no tracking link');
    await settle();
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Your quote/);
    assert.ok(sent[0].html.includes(`#/orders/${quote.id}`) && !sent[0].html.includes('#/track/'));

    r = await call('GET', '/orders?status=quote', { token: t.acme });
    assert.ok(r.data.some((o) => o.id === quote.id), 'shippers see their quotes');
    r = await call('GET', '/orders?status=pending,quote', { token: t.d1 });
    assert.ok(!r.data.some((o) => o.id === quote.id), 'drivers never see quotes');
    assert.equal((await call('POST', `/orders/${quote.id}/accept`, { token: t.d1 })).status, 409);
    assert.equal((await call('POST', `/orders/${quote.id}/assign`, { token: t.dispatcher, body: { driverId: ids.d1 } })).status, 409);
    const { rows: [{ public_token: tok }] } = await db.query('SELECT public_token FROM orders WHERE id = $1', [quote.id]);
    assert.equal((await call('GET', `/track/${tok}`)).status, 404, 'quotes are not trackable');
    assert.equal((await call('POST', `/orders/${quote.id}/checkout`, { token: t.acme })).status, 409, 'book before paying');
    assert.equal((await call('POST', `/orders/${quote.id}/cancel`, { token: t.acme })).status, 409, 'quotes are deleted, not cancelled');
    assert.equal((await call('POST', `/orders/${quote.id}/book`, { token: t.d1 })).status, 403);

    // The customer saw a different price: nothing is booked, the quote shows the current price.
    r = await call('POST', `/orders/${quote.id}/book`, { token: t.acme, body: { expectedCents: quote.priceCents + 1 } });
    assert.equal(r.status, 409);
    assert.equal(r.data.priceChanged, true);
    assert.equal(r.data.order.status, 'quote');
    const current = r.data.order.priceCents;

    sent.length = 0;
    r = await call('POST', `/orders/${quote.id}/book`, { token: t.acme, body: { expectedCents: current } });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'pending');
    assert.equal(r.data.paymentStatus, 'unpaid', 'card customers pay after booking');
    assert.ok(r.data.bookedAt && r.data.trackingUrlToken);
    assert.deepEqual(r.data.events.map((e) => e.type).filter((x) => x !== 'repriced'), ['quoted', 'created']);
    r = await call('POST', `/orders/${quote.id}/checkout`, { token: t.acme });
    assert.equal(r.data.url, 'https://checkout.stripe.com/pay/cs_q');
    await settle();
    assert.match(sent[0].subject, /booked/);
    assert.equal((await call('POST', `/orders/${quote.id}/book`, { token: t.acme })).status, 409, 'already booked');
    assert.equal((await call('DELETE', `/orders/${quote.id}`, { token: t.acme })).status, 409, 'booked orders are not deleted');
    await call('POST', `/orders/${quote.id}/cancel`, { token: t.acme });

    // A pickup time that passed while the quote sat is booked as ASAP.
    r = await call('POST', '/orders', { token: t.acme, body: orderBody({ saveAsQuote: true, scheduledAt: '2020-01-04T15:00:00Z' }) });
    r = await call('POST', `/orders/${r.data.id}/book`, { token: t.acme });
    assert.equal(r.data.status, 'pending');
    assert.equal(r.data.scheduledAt, null);
    await call('POST', `/orders/${r.data.id}/cancel`, { token: t.acme });

    r = await call('POST', '/orders', { token: t.acme, body: orderBody({ saveAsQuote: true }) });
    assert.equal((await call('DELETE', `/orders/${r.data.id}`, { token: t.acme })).status, 204);
    assert.equal((await call('GET', `/orders/${r.data.id}`, { token: t.acme })).status, 404);
  } finally {
    mailer.setSender(null);
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  }
});
