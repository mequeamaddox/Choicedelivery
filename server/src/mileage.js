// Mileage log: each location a driver's phone sends while online adds the distance from the previous
// one to that day's total (Columbia time). Gaps (app closed, no signal) and GPS jumps aren't counted;
// drivers add missed trips by hand.
const { haversineMiles } = require('./geocode');
const { localTime } = require('./pricing');

const MAX_GAP_MS = 10 * 60 * 1000; // longer than this since the last position: start fresh
const MIN_STEP_MILES = 0.03;       // smaller moves are GPS drift while parked
const MAX_MPH = 90;                // faster than this is a bad fix, not driving

const ACTIVE_JOB = ['accepted', 'at_pickup', 'in_transit', 'at_dropoff'];

// Miles to add for a move from prev ({ lat, lng }, at) to next at `now`, or 0.
function stepMiles(prev, prevAt, next, now = new Date()) {
  if (!prev || !prevAt) return 0;
  const ms = now - new Date(prevAt);
  if (ms <= 0 || ms > MAX_GAP_MS) return 0;
  const miles = haversineMiles(prev, next);
  if (miles < MIN_STEP_MILES || miles / (ms / 3600000) > MAX_MPH) return 0;
  return miles;
}

// Saves the driver's new location and adds the miles since the last one. Runs in a transaction.
async function recordLocation(client, driverId, location, now = new Date()) {
  const { rows: [prev] } = await client.query(
    'SELECT last_location, location_updated_at FROM users WHERE id = $1 FOR UPDATE', [driverId]);
  await client.query('UPDATE users SET last_location = $1, location_updated_at = $3 WHERE id = $2',
    [JSON.stringify(location), driverId, now]);
  const miles = stepMiles(prev?.last_location, prev?.location_updated_at, location, now);
  if (!miles) return 0;
  const { rows: [job] } = await client.query(
    'SELECT 1 FROM orders WHERE driver_id = $1 AND status = ANY($2) LIMIT 1', [driverId, ACTIVE_JOB]);
  await client.query(
    `INSERT INTO driver_mileage (driver_id, day, miles, job_miles) VALUES ($1, $2, $3, $4)
     ON CONFLICT (driver_id, day) DO UPDATE SET miles = driver_mileage.miles + EXCLUDED.miles,
       job_miles = driver_mileage.job_miles + EXCLUDED.job_miles`,
    [driverId, localTime(now).date, miles, job ? miles : 0]);
  return miles;
}

const round1 = (n) => Math.round(Number(n) * 10) / 10;

// One driver's log for a year: a row per day with tracked miles, added trips and completed jobs.
async function mileageLog(client, driverId, year) {
  const from = `${year}-01-01`;
  const to = `${year + 1}-01-01`;
  const [tracked, entries, jobs] = await Promise.all([
    client.query('SELECT day::text, miles, job_miles FROM driver_mileage WHERE driver_id = $1 AND day >= $2 AND day < $3',
      [driverId, from, to]),
    client.query(`SELECT id, day::text, miles, note FROM mileage_entries WHERE driver_id = $1 AND day >= $2 AND day < $3
      ORDER BY created_at`, [driverId, from, to]),
    client.query(`SELECT (completed_at AT TIME ZONE 'America/New_York')::date::text AS day, order_number
      FROM orders WHERE driver_id = $1 AND status = 'completed'
        AND completed_at >= ($2::date AT TIME ZONE 'America/New_York') AND completed_at < ($3::date AT TIME ZONE 'America/New_York')
      ORDER BY completed_at`, [driverId, from, to]),
  ]);
  const days = new Map();
  const dayRow = (day) => {
    if (!days.has(day)) days.set(day, { day, trackedMiles: 0, jobMiles: 0, addedMiles: 0, entries: [], jobs: [] });
    return days.get(day);
  };
  for (const r of tracked.rows) Object.assign(dayRow(r.day), { trackedMiles: round1(r.miles), jobMiles: round1(r.job_miles) });
  for (const e of entries.rows) {
    const d = dayRow(e.day);
    d.entries.push({ id: e.id, miles: round1(e.miles), note: e.note });
    d.addedMiles = round1(d.addedMiles + Number(e.miles));
  }
  for (const j of jobs.rows) dayRow(j.day).jobs.push(j.order_number);
  const list = [...days.values()].map((d) => ({ ...d, totalMiles: round1(d.trackedMiles + d.addedMiles) }))
    .filter((d) => d.totalMiles > 0 || d.jobs.length)
    .sort((a, b) => (a.day < b.day ? 1 : -1));
  const total = (key) => round1(list.reduce((sum, d) => sum + d[key], 0));
  return {
    year,
    days: list,
    totals: { trackedMiles: total('trackedMiles'), addedMiles: total('addedMiles'), totalMiles: total('totalMiles'), jobMiles: total('jobMiles') },
  };
}

module.exports = { stepMiles, recordLocation, mileageLog, MAX_GAP_MS };
