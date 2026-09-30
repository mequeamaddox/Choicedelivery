// Sample data for trying the system out: companies, drivers, shippers, orders in every stage and
// website leads, all around Columbia, SC. Everything is flagged is_demo so it can be removed without
// touching real records. Demo accounts get random passwords (nobody can log in as them), have no push
// tokens, and demo orders are hidden from real drivers and excluded from pricing.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { calculatePrice, routeMiles } = require('./pricing');

const MIN = 60 * 1000;
const ago = (minutes) => new Date(Date.now() - minutes * MIN);

const signatureSvg = (name) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="90"><rect width="240" height="90" fill="#fff"/>`
  + `<path d="M12 60 C 40 15, 60 85, 92 40 S 140 20, 165 55 S 205 70, 228 28" stroke="#0f172a" stroke-width="3" fill="none"/>`
  + `<text x="12" y="84" font-family="sans-serif" font-size="11" fill="#64748b">${name} (demo)</text></svg>`
).toString('base64');

const photoSvg = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#e2e8f0"/>'
  + '<rect x="70" y="50" width="100" height="70" fill="#b45309"/><rect x="70" y="50" width="100" height="12" fill="#92400e"/>'
  + '<text x="120" y="145" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#475569">Package at door (demo)</text></svg>'
).toString('base64');

const PLACES = {
  lawOffice: ['1230 Main St, Columbia, SC 29201', 34.0016, -81.0351],
  courthouse: ['1701 Main St, Columbia, SC 29201', 34.0096, -81.0357],
  medPark: ['2 Medical Park Rd, Columbia, SC 29203', 34.0247, -81.0205],
  lab: ['7 Richland Medical Park Dr, Columbia, SC 29203', 34.0281, -81.0233],
  clinicNE: ['1330 Taylor St, Columbia, SC 29201', 34.0063, -81.0322],
  realty: ['4711 Forest Dr, Columbia, SC 29206', 34.0152, -80.9730],
  irmo: ['100 Lake Murray Blvd, Irmo, SC 29063', 34.0859, -81.1832],
  sumter: ['1015 Sumter St, Columbia, SC 29201', 34.0019, -81.0317],
  hampton: ['2020 Hampton St, Columbia, SC 29204', 34.0092, -81.0196],
  lexington: ['100 E Main St, Lexington, SC 29072', 33.9815, -81.2362],
  titleCo: ['1333 Main St, Columbia, SC 29201', 34.0027, -81.0346],
  usc: ['1523 Greene St, Columbia, SC 29201', 33.9985, -81.0270],
  vista: ['701 Gervais St, Columbia, SC 29201', 33.9988, -81.0442],
};
const place = (key, extra = {}) => {
  const [address, lat, lng] = PLACES[key];
  return { address, location: { lat, lng }, ...extra };
};

async function hasDemoData(client) {
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM orders WHERE is_demo)::int AS orders,
            (SELECT count(*) FROM users WHERE is_demo)::int AS users,
            (SELECT count(*) FROM organizations WHERE is_demo)::int AS companies,
            (SELECT count(*) FROM leads WHERE is_demo)::int AS leads`);
  const c = rows[0];
  return { loaded: c.orders + c.users + c.companies + c.leads > 0, counts: c };
}

async function removeDemoData(client) {
  // Stops and order events are removed with their orders (ON DELETE CASCADE).
  const orders = await client.query('DELETE FROM orders WHERE is_demo');
  const leads = await client.query('DELETE FROM leads WHERE is_demo');
  const users = await client.query('DELETE FROM users WHERE is_demo');
  const companies = await client.query('DELETE FROM organizations WHERE is_demo');
  return { orders: orders.rowCount, leads: leads.rowCount, users: users.rowCount, companies: companies.rowCount };
}

async function loadDemoData(client, actorId) {
  await removeDemoData(client); // loading twice replaces the old sample set
  const unusablePassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
  const tag = crypto.randomBytes(3).toString('hex'); // keeps demo emails unique

  const company = async (name, phone, billingEmail, address) => (await client.query(
    `INSERT INTO organizations (name, phone, billing_email, address, is_demo) VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [name, phone, billingEmail, address])).rows[0].id;
  const person = async ({ name, role, phone, orgId = null, online = false, location = null, vehicle = null }) => {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}.${tag}@demo.choicedeliverysc.com`;
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, role, name, phone_number, organization_id, is_online,
                          last_location, location_updated_at, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true) RETURNING id`,
      [email, unusablePassword, role, name, phone, orgId, online, location && JSON.stringify(location), location ? ago(2) : null]);
    if (vehicle) await client.query('INSERT INTO vehicles (driver_id, type) VALUES ($1, $2)', [rows[0].id, vehicle]);
    return rows[0].id;
  };

  const legal = await company('Midlands Legal Group', '803-555-0110', 'billing@midlandslegal.demo', '1230 Main St, Columbia, SC');
  const medical = await company('Carolina Family Medicine', '803-555-0120', 'office@cfm.demo', '2 Medical Park Rd, Columbia, SC');
  const realty = await company('Congaree Realty', '803-555-0130', 'closings@congaree.demo', '4711 Forest Dr, Columbia, SC');

  const legalUser = await person({ name: 'Dana Whitfield', role: 'shipper', phone: '803-555-0111', orgId: legal });
  const medUser = await person({ name: 'Priya Shah', role: 'shipper', phone: '803-555-0121', orgId: medical });
  const realtyUser = await person({ name: 'Chris Albright', role: 'shipper', phone: '803-555-0131', orgId: realty });
  const marcus = await person({ name: 'Marcus Reed', role: 'driver', phone: '803-555-0141', online: true,
    location: { lat: 34.0122, lng: -81.0101 }, vehicle: 'Cargo Van' });
  const tasha = await person({ name: 'Tasha Green', role: 'driver', phone: '803-555-0142', online: true,
    location: { lat: 34.0058, lng: -81.0248 }, vehicle: 'Car' });
  const luis = await person({ name: 'Luis Ortega', role: 'driver', phone: '803-555-0143', online: false,
    location: { lat: 34.0270, lng: -81.0229 }, vehicle: 'Truck' });

  // Each order: stops in route order with their progress; events are generated from the timeline.
  const orders = [
    { org: legal, by: legalUser, status: 'pending', createdMin: 12, vehicle: 'Car', level: 'rush',
      description: 'Signed motion for same-day filing', weight: '1 lb', pieces: '1',
      stops: [place('lawOffice', { contactName: 'Front desk', contactPhone: '803-555-0112', instructions: 'Envelope at reception' }),
        place('courthouse', { contactName: 'Clerk of Court', instructions: 'File with clerk, 2nd floor' })] },
    { org: medical, by: medUser, status: 'pending', createdMin: 25, vehicle: 'Car', level: 'standard',
      description: 'Sealed lab specimens (keep upright)', weight: '4 lbs', pieces: '2',
      stops: [place('medPark', { contactName: 'Lab pickup window' }), place('lab', { contactName: 'Receiving' })] },
    { org: realty, by: realtyUser, status: 'accepted', driver: marcus, createdMin: 50, acceptedMin: 40, vehicle: 'Cargo Van',
      level: 'standard', description: 'Closing binders and keys', weight: '12 lbs', pieces: '3',
      stops: [place('realty', { contactName: 'Chris Albright', contactPhone: '803-555-0131' }),
        place('irmo', { contactName: 'Lake Murray Title', instructions: 'Ask for the closing coordinator' })] },
    { org: legal, by: legalUser, status: 'in_transit', driver: tasha, createdMin: 75, acceptedMin: 70, vehicle: 'Car',
      level: 'standard', description: 'Contract originals for signature', weight: '2 lbs', pieces: '1',
      stops: [place('sumter', { status: 'completed', doneMin: 45, signedBy: 'R. Hollis', contactName: 'Hollis & Park' }),
        place('hampton', { contactName: 'Jane Doe', contactPhone: '803-555-0142' })] },
    { org: medical, by: medUser, status: 'at_dropoff', driver: luis, createdMin: 120, acceptedMin: 110, vehicle: 'Truck',
      level: 'standard', description: 'Supply restock for two clinics', weight: '180 lbs', pieces: '9',
      stops: [place('medPark', { status: 'completed', doneMin: 80, signedBy: 'Warehouse' }),
        place('clinicNE', { status: 'completed', doneMin: 30, signedBy: 'M. Lee', photo: true }),
        place('lab', { status: 'arrived', arrivedMin: 3, contactName: 'Supply room' })] },
    { org: realty, by: realtyUser, status: 'completed', driver: marcus, createdMin: 26 * 60, acceptedMin: 25.8 * 60,
      vehicle: 'Car', level: 'rush', description: 'Earnest money check', weight: '1 lb', pieces: '1',
      stops: [place('titleCo', { status: 'completed', doneMin: 25.5 * 60, signedBy: 'Title desk' }),
        place('lexington', { status: 'completed', doneMin: 24.7 * 60, signedBy: 'K. Brown', photo: true })] },
    { org: legal, by: legalUser, status: 'completed', driver: tasha, createdMin: 50 * 60, acceptedMin: 49.9 * 60,
      vehicle: 'Car', level: 'standard', description: 'Deposition transcripts', weight: '6 lbs', pieces: '2',
      stops: [place('lawOffice', { status: 'completed', doneMin: 49.5 * 60, signedBy: 'Front desk' }),
        place('vista', { status: 'completed', doneMin: 49 * 60, signedBy: 'A. Moore' })] },
    { org: realty, by: realtyUser, status: 'quote', createdMin: 3 * 60, vehicle: 'Cargo Van', level: 'standard',
      description: 'Staging furniture for open house (saved quote)', weight: '300 lbs', pieces: '6',
      stops: [place('titleCo', { contactName: 'Office' }), place('lexington', { contactName: 'Listing agent' })] },
    { org: medical, by: medUser, status: 'cancelled', createdMin: 30 * 60, cancelledMin: 29.5 * 60, vehicle: 'Car',
      level: 'standard', description: 'Pharmacy transfer (cancelled by office)', weight: '2 lbs', pieces: '1',
      stops: [place('medPark'), place('usc', { contactName: 'Student health' })] },
  ];

  for (const [index, o] of orders.entries()) {
    const created = ago(o.createdMin);
    const stopsDone = o.stops.every((s) => s.status === 'completed');
    const breakdown = calculatePrice({
      distanceMiles: routeMiles(o.stops.map((s) => s.location)), serviceLevel: o.level, at: created, openOrders: 0,
    });
    const { rows: [{ id }] } = await client.query(
      // Own numbering (DEMO-1001...) so sample orders don't use up real CD- order numbers.
      `INSERT INTO orders (organization_id, created_by, driver_id, status, vehicle_type, weight, number_of_pieces,
         description, price_cents, price_breakdown, distance_miles, service_level, accepted_at, completed_at,
         cancelled_at, created_at, updated_at, is_demo, order_number, booked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,true,$17,
               CASE WHEN $4 = 'quote' THEN NULL ELSE $16::timestamptz END) RETURNING id`,
      [o.org, o.by, o.driver || null, o.status, o.vehicle, o.weight, o.pieces, o.description, breakdown.totalCents,
        JSON.stringify(breakdown), breakdown.distanceMiles, o.level, o.acceptedMin ? ago(o.acceptedMin) : null,
        o.status === 'completed' && stopsDone ? ago(Math.min(...o.stops.map((s) => s.doneMin))) : null,
        o.cancelledMin ? ago(o.cancelledMin) : null, created, `DEMO-${1001 + index}`]);

    const events = [[created, o.by, o.status === 'quote' ? 'quoted' : 'created', {}]];
    if (o.acceptedMin) events.push([ago(o.acceptedMin), o.driver, 'accepted', {}]);
    for (let i = 0; i < o.stops.length; i++) {
      const s = o.stops[i];
      const status = s.status || 'pending';
      const arrived = s.arrivedMin ? ago(s.arrivedMin) : s.doneMin ? ago(s.doneMin + 4) : null;
      const done = s.doneMin ? ago(s.doneMin) : null;
      await client.query(
        `INSERT INTO stops (order_id, sequence, type, status, address, location, contact_name, contact_phone,
           instructions, arrived_at, completed_at, signature, photo, printed_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id, i + 1, i === 0 ? 'pickup' : 'dropoff', status, s.address, JSON.stringify(s.location),
          s.contactName || '', s.contactPhone || '', s.instructions || '', arrived, done,
          s.signedBy ? signatureSvg(s.signedBy) : null, s.photo ? photoSvg : null, s.signedBy || null]);
      const type = i === 0 ? 'pickup' : 'dropoff';
      if (arrived) events.push([arrived, o.driver, 'stop_arrived', { type }]);
      if (done) events.push([done, o.driver, 'stop_completed', { type, printedName: s.signedBy }]);
    }
    if (o.status === 'completed') events.push([ago(Math.min(...o.stops.map((s) => s.doneMin))), o.driver, 'completed', {}]);
    if (o.cancelledMin) events.push([ago(o.cancelledMin), o.by, 'cancelled', { reason: 'Office rescheduled' }]);
    if (o.status === 'in_transit') {
      await client.query("UPDATE orders SET notes = $2 WHERE id = $1", [id, JSON.stringify([
        { note: 'Picked up, heading downtown now.', authorId: o.driver, authorRole: 'driver', createdAt: ago(44).toISOString() }])]);
    }
    for (const [at, actor, type, data] of events.sort((a, b) => a[0] - b[0])) {
      await client.query('INSERT INTO order_events (order_id, actor_id, type, data, created_at) VALUES ($1,$2,$3,$4,$5)',
        [id, actor, type, JSON.stringify(data), at]);
    }
  }

  await client.query(
    `INSERT INTO leads (type, name, company, email, phone, message, plan, status, created_at, is_demo) VALUES
     ('contract', 'Dr. Angela Price', 'Price Pediatrics', 'angela@pricepeds.demo', '803-555-0150',
      'We send lab work out daily. Interested in the medical plan.', 'medical', 'new', $1, true),
     ('contact', 'Tom Nguyen', 'Vista Print Shop', 'tom@vistaprint.demo', '803-555-0160',
      'Do you deliver large banners to Charleston on weekends?', NULL, 'contacted', $2, true)`,
    [ago(90), ago(26 * 60)]);

  return (await hasDemoData(client)).counts;
}

module.exports = { hasDemoData, loadDemoData, removeDemoData };
