// Runs the app's API client (src/lib/api.js) against the real server in ../server with a throwaway
// database, walking through a driver's whole day. Needs TEST_DATABASE_URL (it is wiped):
//   TEST_DATABASE_URL=postgres://... npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createApi, nextStop, mapsUrl, minutesSince } from '../src/lib/api.js';

const require = createRequire(import.meta.url);
const DB = process.env.TEST_DATABASE_URL;
let server; let base; let db;

before(async () => {
  if (!DB) return;
  process.env.DATABASE_URL = DB;
  process.env.JWT_SECRET = 'driver-app-test';
  db = require('../../server/src/db');
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  const app = require('../../server/src/app');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server?.close(); await db?.pool.end(); });

const clientFor = () => {
  let token = null;
  let kicked = 0;
  const api = createApi({ baseUrl: base, getToken: async () => token, onUnauthorized: () => { kicked++; } });
  return { api, setToken: (t) => { token = t; }, kicked: () => kicked };
};

test('helpers', () => {
  const order = { stops: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'arrived' }, { id: 'c', status: 'pending' }] };
  assert.equal(nextStop(order).id, 'b');
  assert.equal(nextStop({ stops: [{ status: 'completed' }] }), null);
  assert.match(mapsUrl({ location: { lat: 34, lng: -81 }, address: 'x' }), /destination=34,-81$/);
  assert.match(mapsUrl({ address: '1 Main St, Columbia' }), /destination=1%20Main%20St%2C%20Columbia$/);
  assert.equal(minutesSince(new Date(Date.now() - 16 * 60000).toISOString()), 16);
});

test('a driver goes online, accepts a job, works both stops and sees it in history', { skip: !DB && 'set TEST_DATABASE_URL' }, async () => {
  const admin = clientFor();
  let r = await admin.api.request('/auth/register', { method: 'POST', body: { email: 'owner@t.dev', password: 'ownerpass1', name: 'Owner' } });
  admin.setToken(r.token);
  await admin.api.request('/auth/register', { method: 'POST', body: { email: 'rae@t.dev', password: 'driverpass1', name: 'Rae Driver', role: 'driver' } });
  await admin.api.request('/auth/register', { method: 'POST', body: { email: 'kim@t.dev', password: 'driverpass1', name: 'Kim', role: 'driver' } });

  const d = clientFor();
  await assert.rejects(d.api.login('rae@t.dev', 'wrong'), (e) => e.status === 401 && /Invalid email or password/.test(e.message));
  assert.equal(d.kicked(), 0, 'a failed login is not a sign-out');
  const login = await d.api.login('rae@t.dev', 'driverpass1');
  assert.equal(login.user.role, 'driver');
  d.setToken(login.token);

  assert.deepEqual(await d.api.setOnline(true), { online: true });
  await d.api.sendLocation(34.0102, -81.0280);
  await d.api.updateMe({ phoneNumber: '803-555-0101', vehicleType: 'Pickup Truck' });
  const me = await d.api.me();
  assert.equal(me.isOnline, true);
  assert.equal(me.vehicleType, 'Pickup Truck');

  const order = await admin.api.request('/orders', { method: 'POST', body: {
    vehicleType: 'Car', weight: '10 lbs', numberOfPieces: '1', maxPieceLbs: 10, trackingNumber: 'PKG-777', addOns: ['loading_help'],
    stops: [
      { type: 'pickup', address: '1230 Main St, Columbia, SC', location: { lat: 34.0016, lng: -81.0351 }, contactName: 'Front desk', contactPhone: '8035550100' },
      { type: 'dropoff', address: '1 Gervais St, Columbia, SC', location: { lat: 33.9946, lng: -81.0489 }, contactName: 'Jane' },
    ] } });
  const second = await admin.api.request('/orders', { method: 'POST', body: {
    vehicleType: 'Car', weight: '5 lbs', numberOfPieces: '1', maxPieceLbs: 5, trackingNumber: 'PKG-888',
    stops: [{ type: 'pickup', address: 'A', location: { lat: 34, lng: -81 } }, { type: 'dropoff', address: 'B', location: { lat: 34.01, lng: -81 } }] } });

  const open = await d.api.openJobs();
  assert.deepEqual(open.map((o) => o.id).sort(), [order.id, second.id].sort());
  const detail = await d.api.job(order.id);
  assert.deepEqual(detail.addOns, ['loading_help'], 'drivers see booked extras');
  assert.equal(detail.maxPieceLbs, 10);

  let job = await d.api.accept(order.id);
  assert.equal(job.status, 'accepted');
  const k = clientFor();
  k.setToken((await k.api.login('kim@t.dev', 'driverpass1')).token);
  await assert.rejects(k.api.accept(order.id), (e) => e.status === 409, 'first driver wins');
  assert.deepEqual((await d.api.myActiveJobs()).map((o) => o.id), [order.id]);

  const pickup = nextStop(job);
  await assert.rejects(d.api.complete(order.id, job.stops[1].id, { signature: 'data:x' }), (e) => e.status === 409, 'stops go in order');
  job = await d.api.arrive(order.id, pickup.id);
  assert.equal(job.status, 'at_pickup');
  await assert.rejects(d.api.complete(order.id, pickup.id, {}), (e) => /signature, photo or barcode/.test(e.message));
  job = await d.api.complete(order.id, pickup.id, { signature: 'data:image/png;base64,AAAA', printedName: 'Front desk' });
  assert.equal(job.status, 'in_transit');
  job = await d.api.addNote(order.id, 'Traffic on Assembly, 10 min out');
  assert.equal(job.notes.at(-1).note, 'Traffic on Assembly, 10 min out');
  const drop = nextStop(job);
  job = await d.api.arrive(order.id, drop.id);
  job = await d.api.complete(order.id, drop.id, { photo: 'data:image/jpeg;base64,BBBB', printedName: 'Jane' });
  assert.equal(job.status, 'completed');
  assert.equal(nextStop(job), null);
  assert.deepEqual((await d.api.history()).map((o) => o.id), [order.id]);

  // Barcode scan at pickup claims the open job and completes the pickup.
  job = await d.api.scan('PKG-888');
  assert.equal(job.id, second.id);
  assert.equal(job.status, 'in_transit');
  await assert.rejects(d.api.scan('NOPE'), (e) => e.status === 404);

  const tracking = await admin.api.request(`/orders/${second.id}`);
  assert.deepEqual(tracking.driver.location, { lat: 34.0102, lng: -81.028 }, 'dispatch sees where the driver is');

  // A disabled driver is signed out on their next request.
  const kimId = (await admin.api.request('/users?role=driver')).find((u) => u.email === 'kim@t.dev').id;
  await admin.api.request(`/users/${kimId}`, { method: 'PATCH', body: { isActive: false } });
  await assert.rejects(k.api.openJobs(), (e) => e.status === 401);
  assert.equal(k.kicked(), 1, 'the app signs a disabled driver out');

  const pricing = await d.api.pricing();
  assert.equal(pricing.fees.waitFreeMinutes, 15);
  assert.deepEqual(pricing.vehicleTypes, ['Car', 'Minivan', 'Pickup Truck']);
  await d.api.setOnline(false);
  assert.equal((await d.api.me()).isOnline, false);
});

test('network failures give a readable error', async () => {
  const api = createApi({ baseUrl: 'http://127.0.0.1:1', getToken: async () => null });
  await assert.rejects(api.openJobs(), (e) => e.status === 0 && /internet connection/.test(e.message));
});

test('a new driver applies in the app, fills in their profile and gets approved', { skip: !DB && 'set TEST_DATABASE_URL' }, async () => {
  const admin = clientFor();
  admin.setToken((await admin.api.login('owner@t.dev', 'ownerpass1')).token);
  const d = clientFor();
  await assert.rejects(d.api.driverSignup({ name: 'New', email: 'new@t.dev', password: 'newpass12', phoneNumber: '1', vehicle: { type: 'Car' } }),
    (e) => e.status === 400 && /agree/.test(e.message));
  const { token, user } = await d.api.driverSignup({ name: 'Nia New', email: 'nia@t.dev', password: 'niapass12', phoneNumber: '803-555-0123',
    city: 'Columbia', zip: '29205', agreed: true, vehicle: { type: 'Minivan', make: 'Toyota', model: 'Sienna', year: '2018', color: 'Gray', plate: 'nia1' } });
  d.setToken(token);
  assert.equal(user.driverStatus, 'applied');
  assert.match(user.workBlocker, /being reviewed/);
  assert.deepEqual(await d.api.openJobs(), []);
  await assert.rejects(d.api.setOnline(true), (e) => e.status === 409);

  const img = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
  let me = await d.api.updateMe({ driverProfile: {
    license: { number: 'L1', state: 'SC', expires: '2031-01-01' }, insurance: { company: 'Geico', expires: '2031-01-01' } } });
  for (const kind of ['photo', 'license_front', 'insurance', 'vehicle']) me = await d.api.uploadDocument(kind, img);
  assert.equal(me.checklist.complete, true, JSON.stringify(me.checklist));
  assert.equal((await d.api.document(me.id, 'insurance')).data, img);
  await d.api.changePassword('niapass12', 'niapass34');
  await assert.rejects(d.api.changePassword('wrong', 'whatever1'), (e) => e.status === 400);

  await admin.api.request(`/users/${me.id}/review`, { method: 'POST', body: { status: 'approved' } });
  me = await d.api.me();
  assert.equal(me.workBlocker, null);
  assert.deepEqual(await d.api.setOnline(true), { online: true });
  assert.equal((await d.api.login('nia@t.dev', 'niapass34')).user.driverStatus, 'approved');
});
