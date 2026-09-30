// Imports pickups from a Firebase Realtime Database JSON export.
// In the Firebase console: Realtime Database -> ⋮ -> Export JSON. Then:
//   DATABASE_URL=... npm run import-firebase -- ./export.json
// Accepts either the whole-database export ({ "pickups": {...} }) or just the pickups node.
// Firebase driver UIDs can't be mapped to new accounts, so imported jobs are left unassigned
// unless they are still pending.
const fs = require('fs');
const { migrate, pool } = require('../src/db');

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run import-firebase -- <export.json>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const pickups = raw.pickups || raw;

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const str = (v) => (v === undefined || v === null ? '' : String(v));
const loc = (v) => (v && v.lat != null && v.lng != null ? JSON.stringify({ lat: Number(v.lat), lng: Number(v.lng) }) : null);

async function run() {
  await migrate();
  let n = 0;
  for (const [key, p] of Object.entries(pickups)) {
    if (!p || typeof p !== 'object') continue;
    const completed = str(p.status).toLowerCase() === 'completed';
    await pool.query(
      `INSERT INTO pickups (id, status, contact_name, contact_phone, pickup_address, destination_address,
         weight, number_of_pieces, vehicle_type, pickup_date, pickup_location, delivery_location,
         pickup_signature, pickup_image, picked_up_at, delivery_signature, delivery_image, printed_name, delivered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz, now()),$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO NOTHING`,
      [
        String(p.request_id || key), str(p.status) || 'Pending', str(p.contact_name), str(p.contact_phone),
        str(p.pickup_address), str(p.destination_address), str(p.weight), str(p.number_of_pieces),
        str(p.vehicle_type), toDate(p.pickup_date), loc(p.pickup_location), loc(p.delivery_location),
        completed ? null : p.signature || null, completed ? null : p.image || null, toDate(p.confirmedAt),
        completed ? p.signature || null : null, completed ? p.image || null : null,
        p.printedName || null, toDate(p.deliveryTimestamp),
      ]
    );
    n++;
  }
  console.log(`Imported ${n} pickups (existing ids were skipped).`);
}

run().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
