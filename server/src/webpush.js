// Phone alerts for the owner and dispatch through the "Choice Dispatch" home-screen app (web push).
// The signing keys (VAPID) are made once and kept in settings, so there's nothing to set up in Railway;
// VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in the environment override them.
const webpush = require('web-push');
const db = require('./db');

// What dispatch can be alerted about; each person can turn any of them off.
const KINDS = {
  orders: 'New orders',
  approvals: 'Quotes and prices waiting on you',
  signups: 'New customer signups',
  leads: 'Website messages and emailed quotes',
  payments: 'Invoice payments',
  problems: 'Problems on a delivery',
};

let keys = null;
async function vapidKeys() {
  if (keys) return keys;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    const fresh = webpush.generateVAPIDKeys();
    await db.query("INSERT INTO settings (key, value) VALUES ('web_push_vapid', $1) ON CONFLICT (key) DO NOTHING", [JSON.stringify(fresh)]);
    const { rows: [r] } = await db.query("SELECT value FROM settings WHERE key = 'web_push_vapid'");
    keys = r.value;
  }
  webpush.setVapidDetails(`mailto:${process.env.SUPPORT_EMAIL || 'info@choicedeliverysc.com'}`, keys.publicKey, keys.privateKey);
  return keys;
}

// Tests replace the sender.
let send = (sub, payload) => webpush.sendNotification(sub, payload, { TTL: 6 * 60 * 60 });
function setSender(fn) { send = fn || ((sub, payload) => webpush.sendNotification(sub, payload, { TTL: 6 * 60 * 60 })); }

async function subscribe(userId, sub, device) {
  const endpoint = String(sub?.endpoint || '');
  const { p256dh, auth } = sub?.keys || {};
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return false;
  await db.query(
    `INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth, device) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, device = $5`,
    [userId, endpoint.slice(0, 1000), String(p256dh).slice(0, 200), String(auth).slice(0, 200), String(device || '').slice(0, 120) || null]);
  return true;
}

async function unsubscribe(userId, endpoint) {
  await db.query('DELETE FROM web_push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, String(endpoint || '')]);
}

async function deliver(rows, message) {
  if (!rows.length) return 0;
  await vapidKeys();
  const payload = JSON.stringify(message);
  let sent = 0;
  await Promise.all(rows.map(async (r) => {
    try {
      await send({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload);
      sent += 1;
      db.query('UPDATE web_push_subscriptions SET last_sent_at = now() WHERE id = $1', [r.id]).catch(() => {});
    } catch (e) {
      // The phone turned alerts off or the app was removed: forget it.
      if ([404, 410].includes(e.statusCode)) await db.query('DELETE FROM web_push_subscriptions WHERE id = $1', [r.id]).catch(() => {});
      else console.error('Phone alert failed:', e.statusCode || '', e.message);
    }
  }));
  return sent;
}

// Alerts every owner/dispatcher who has this kind turned on. message: { title, body, url }. Never throws.
async function notifyStaff(kind, message) {
  try {
    const { rows } = await db.query(
      `SELECT s.* FROM web_push_subscriptions s JOIN users u ON u.id = s.user_id
       WHERE u.role IN ('admin', 'dispatcher') AND u.is_active AND COALESCE((u.push_prefs->>$1)::boolean, true)`, [kind]);
    return await deliver(rows, { tag: kind, ...message });
  } catch (e) {
    console.error('Phone alerts failed:', e.message);
    return 0;
  }
}

async function notifyUserDevices(userId, message) {
  const { rows } = await db.query('SELECT * FROM web_push_subscriptions WHERE user_id = $1', [userId]);
  return deliver(rows, message);
}

// Drivers only get job alerts.
const DRIVER_KINDS = { jobs: 'New jobs, and changes to jobs you\'re on' };
const kindsFor = (role) => (role === 'driver' ? DRIVER_KINDS : KINDS);

async function config(userId) {
  const { publicKey } = await vapidKeys();
  const { rows: [u] } = await db.query('SELECT push_prefs, role FROM users WHERE id = $1', [userId]);
  const { rows: [{ n }] } = await db.query('SELECT count(*)::int AS n FROM web_push_subscriptions WHERE user_id = $1', [userId]);
  const prefs = u?.push_prefs || {};
  return { publicKey, devices: n, kinds: Object.entries(kindsFor(u?.role)).map(([key, label]) => ({ key, label, on: prefs[key] !== false })) };
}

async function wants(userId, kind) {
  const { rows: [u] } = await db.query('SELECT push_prefs FROM users WHERE id = $1', [userId]);
  return !!u && u.push_prefs?.[kind] !== false;
}

async function setPrefs(userId, changes) {
  const clean = Object.fromEntries(Object.entries(changes || {}).filter(([k, v]) => (KINDS[k] || DRIVER_KINDS[k]) && typeof v === 'boolean'));
  await db.query('UPDATE users SET push_prefs = push_prefs || $2::jsonb WHERE id = $1', [userId, JSON.stringify(clean)]);
}

module.exports = { KINDS, DRIVER_KINDS, wants, notifyStaff, notifyUserDevices, subscribe, unsubscribe, config, setPrefs, setSender, vapidKeys };
