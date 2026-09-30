// Imports pickups from a Firebase Realtime Database JSON export as orders.
// In the Firebase console: Realtime Database -> ⋮ -> Export JSON. Then:
//   DATABASE_URL=... npm run import-firebase -- ./export.json
// Accepts either the whole-database export ({ "pickups": {...} }) or just the pickups node.
// Firebase driver UIDs don't map to new accounts, so imported jobs are left unassigned.
// Safe to re-run: pickups already imported (by id) are skipped.
const fs = require('fs');
const { migrate, pool, withTx } = require('../src/db');

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
const loc = (v) => {
  if (!v || v.lat == null || v.lng == null) return null;
  const lat = Number(v.lat); const lng = Number(v.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? JSON.stringify({ lat, lng }) : null;
};

// Old free-text statuses -> order status + [pickup stop status, dropoff stop status]
function mapStatus(s) {
  switch (str(s).toLowerCase()) {
    case 'completed': return ['completed', 'completed', 'completed'];
    case 'delivered': return ['at_dropoff', 'completed', 'arrived'];
    case 'in transit': return ['in_transit', 'completed', 'pending'];
    case 'picked up': return ['at_pickup', 'arrived', 'pending'];
    default: return ['pending', 'pending', 'pending'];
  }
}

async function run() {
  await migrate();
  let imported = 0;
  let skipped = 0;
  for (const [key, p] of Object.entries(pickups)) {
    if (!p || typeof p !== 'object') continue;
    const legacyId = String(p.request_id || key);
    const [status, pickupStatus, dropStatus] = mapStatus(p.status);
    // Accepted-but-unfinished jobs can't keep their Firebase driver, so they go back to the open pool.
    const orderStatus = status === 'completed' ? 'completed' : 'pending';
    const done = status === 'completed';
    await withTx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO orders (legacy_id, status, vehicle_type, weight, number_of_pieces, scheduled_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (legacy_id) DO NOTHING RETURNING id`,
        [legacyId, orderStatus, str(p.vehicle_type), str(p.weight), str(p.number_of_pieces),
          toDate(p.pickup_date), done ? toDate(p.deliveryTimestamp) : null]
      );
      if (!rows[0]) { skipped++; return; }
      const id = rows[0].id;
      await client.query(
        `INSERT INTO stops (order_id, sequence, type, status, address, location, contact_name, contact_phone,
                            completed_at, signature, photo)
         VALUES ($1, 1, 'pickup', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, done ? pickupStatus : 'pending', str(p.pickup_address), loc(p.pickup_location), str(p.contact_name),
          str(p.contact_phone), done ? toDate(p.confirmedAt) : null,
          null, null]
      );
      await client.query(
        `INSERT INTO stops (order_id, sequence, type, status, address, location, contact_name, contact_phone,
                            completed_at, signature, photo, printed_name)
         VALUES ($1, 2, 'dropoff', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, done ? dropStatus : 'pending', str(p.destination_address), loc(p.delivery_location), str(p.contact_name),
          str(p.contact_phone), done ? toDate(p.deliveryTimestamp) : null,
          done ? p.signature || null : null,
          done && typeof p.image === 'string' && p.image.startsWith('data:') ? p.image : null,
          p.printedName || null]
      );
      await client.query(
        "INSERT INTO order_events (order_id, type, data) VALUES ($1, 'imported', $2)",
        [id, JSON.stringify({ from: 'firebase', originalStatus: str(p.status) })]
      );
      imported++;
    });
  }
  console.log(`Imported ${imported} orders, skipped ${skipped} already imported.`);
}

run().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
