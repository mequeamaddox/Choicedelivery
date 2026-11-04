// Gig routes: reading the stops off screenshots of gig apps (Amazon Flex, Spark, DoorDash...) with Claude,
// placing them on the map, ordering them, and deleting gig customers' addresses after the route.
// The gig app stays in charge of the delivery itself; this is only the driver's organizer.
const db = require('./db');
const { locate, haversineMiles } = require('./geocode');
const { HttpError } = require('./util');

const APPS = ['Amazon Flex', 'Walmart Spark', 'DoorDash', 'Uber Eats', 'Instacart', 'Roadie', 'GoShare', 'Shipt', 'Grubhub', 'Other'];
const MAX_IMAGES = 10;
const MAX_STOPS = 80;

const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;
let client = null;
function claude() {
  if (!client) {
    const Anthropic = require('@anthropic-ai/sdk').default;
    client = new Anthropic(); // reads ANTHROPIC_API_KEY
  }
  return client;
}
const setClient = (c) => { client = c; }; // for tests

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    app: { type: ['string', 'null'], description: 'Which gig app the screenshots are from, if recognizable' },
    stops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Full street address with city, state and ZIP when shown' },
          note: { type: 'string', description: 'Short delivery detail shown with the stop (package count, time window, apartment/unit, pickup vs drop-off); no customer names or phone numbers' },
        },
        required: ['address', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['app', 'stops'],
  additionalProperties: false,
};

const SYSTEM = `You read screenshots (or pasted text) from gig delivery apps such as Amazon Flex, Walmart Spark, DoorDash,
Uber Eats, Instacart, Roadie, GoShare and Shipt, and list the delivery stops they show, in the order shown.

- One entry per distinct stop address. If several screenshots overlap (a scrolled list), list each stop once.
- Copy the address exactly as shown; include unit/apartment numbers in the address. If the city or state is missing,
  leave it out rather than guessing.
- The note holds only short delivery details visible for that stop (for example "3 packages", "Pickup", "Deliver by
  2:30", "Gate code shown in app" - never the code itself). Leave customer names, phone numbers and access codes out.
- Ignore map labels, ads, buttons and anything that isn't a stop.
- If nothing looks like a delivery stop, return an empty list.`;

// Images: data URLs from the phone (JPEG/PNG/WebP). text: pasted stop list. Returns { app, stops }.
async function extractStops({ images = [], text = '' }) {
  const imgs = images.slice(0, MAX_IMAGES).map((d) => {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(String(d));
    if (!m) throw new HttpError(400, 'Screenshots have to be photos (JPEG or PNG)');
    return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
  });
  const pasted = String(text || '').slice(0, 20000).trim();
  if (!imgs.length && !pasted) throw new HttpError(400, 'Add a screenshot or paste the stops');
  if (!aiEnabled()) {
    if (imgs.length) throw new HttpError(503, 'Reading screenshots is not set up yet (ANTHROPIC_API_KEY). Paste the addresses instead.');
    return { app: null, stops: splitAddresses(pasted) };
  }
  const content = [...imgs, { type: 'text', text: pasted ? `Pasted from the app:\n${pasted}` : 'List the delivery stops in these screenshots.' }];
  const response = await claude().beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new HttpError(422, "Those screenshots couldn't be read. Try clearer screenshots or paste the addresses.");
  const block = response.content.find((b) => b.type === 'text');
  let parsed;
  try { parsed = JSON.parse(block?.text || ''); } catch { throw new HttpError(502, "Couldn't read the stops this time. Try again."); }
  return {
    app: APPS.find((a) => a.toLowerCase() === String(parsed.app || '').toLowerCase()) || (parsed.app ? 'Other' : null),
    stops: (parsed.stops || []).map((s) => ({ address: String(s.address || '').trim().slice(0, 300), note: String(s.note || '').trim().slice(0, 200) }))
      .filter((s) => s.address).slice(0, MAX_STOPS),
  };
}

// Without AI: one stop per line that starts with a house number ("123 Main St, Columbia SC").
function splitAddresses(text) {
  return text.split(/\r?\n/).map((l) => l.replace(/^\s*(\d+[.)]|[-•*])\s+/, '').trim())
    .filter((l) => /^\d+\s+\S+/.test(l)).slice(0, MAX_STOPS).map((address) => ({ address: address.slice(0, 300), note: '' }));
}

// Places a route's stops on the map in the background (the address lookup allows about one per second).
async function locateRoute(routeId) {
  const { rows } = await db.query('SELECT id, address FROM gig_stops WHERE route_id = $1 AND NOT located ORDER BY sequence', [routeId]);
  for (const s of rows) {
    const loc = await locate(s.address).catch(() => null);
    await db.query('UPDATE gig_stops SET location = $2, located = true WHERE id = $1', [s.id, loc ? JSON.stringify(loc) : null]);
  }
}

// Shortest-looking order for the stops still to do: nearest stop next, starting from `from` (the phone's
// location) or the first stop. Stops that couldn't be placed on the map keep their place at the end.
function nearestOrder(stops, from) {
  const todo = stops.filter((s) => !s.done_at && s.location);
  const rest = stops.filter((s) => s.done_at || !s.location);
  const out = [];
  let here = from || todo[0]?.location;
  while (todo.length) {
    let best = 0;
    for (let i = 1; i < todo.length; i++) {
      if (haversineMiles(here, todo[i].location) < haversineMiles(here, todo[best].location)) best = i;
    }
    const [next] = todo.splice(best, 1);
    out.push(next);
    here = next.location;
  }
  return [...rest.filter((s) => s.done_at), ...out, ...rest.filter((s) => !s.done_at)];
}

// Road miles are roughly 1.2x the straight line between stops.
function routeMiles(stops) {
  const pts = stops.map((s) => s.location).filter(Boolean);
  let miles = 0;
  for (let i = 1; i < pts.length; i++) miles += haversineMiles(pts[i - 1], pts[i]) * 1.2;
  return Math.round(miles * 10) / 10;
}

// Gig customers' addresses are theirs, not ours: a finished route's stops are deleted after a day, and any
// route after two days.
async function purgeOldStops() {
  await db.query(
    `DELETE FROM gig_routes WHERE (status = 'done' AND finished_at < now() - interval '1 day')
       OR created_at < now() - interval '2 days'`);
}

function startPurgeTimer() {
  const tick = () => purgeOldStops().catch((e) => console.error('Gig route cleanup failed:', e.message));
  setTimeout(tick, 60 * 1000).unref?.();
  setInterval(tick, 60 * 60 * 1000).unref?.();
}

module.exports = { APPS, aiEnabled, extractStops, splitAddresses, locateRoute, nearestOrder, routeMiles, purgeOldStops, startPurgeTimer, setClient };
