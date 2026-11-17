// Messages between dispatch and drivers (#/messages for dispatch, #/driver/messages for drivers). Each driver
// has one conversation with dispatch; dispatch can also message every driver at once. Every message sends a
// phone alert to the other side.
const express = require('express');
const db = require('../db');
const { requireAuth, requireRole, isStaff } = require('../auth');
const { asyncH, HttpError, str } = require('../util');

const router = express.Router();
router.use(requireAuth);
const staffOnly = requireRole('admin', 'dispatcher');
const MAX = 2000;

const serialize = (m) => ({
  id: m.id, body: m.body, fromStaff: m.from_staff, senderName: m.sender_name || null, orderId: m.order_id || null,
  orderNumber: m.order_number || null, broadcast: m.broadcast, readAt: m.read_at, createdAt: m.created_at,
});

const bodyOf = (req) => {
  const body = str(req.body?.body).slice(0, MAX);
  if (!body) throw new HttpError(400, 'Type a message');
  return body;
};

// The latest messages in a driver's conversation (oldest first), marking what the reader got as read.
async function conversation(driverId, { staffReading }) {
  await db.query('UPDATE messages SET read_at = now() WHERE driver_id = $1 AND from_staff = $2 AND read_at IS NULL',
    [driverId, !staffReading]);
  const { rows } = await db.query(
    `SELECT m.*, s.name AS sender_name, o.order_number FROM messages m
     LEFT JOIN users s ON s.id = m.sender_id LEFT JOIN orders o ON o.id = m.order_id
     WHERE m.driver_id = $1 ORDER BY m.created_at DESC LIMIT 200`, [driverId]);
  return rows.reverse().map(serialize);
}

async function insert({ driverId, senderId, fromStaff, body, orderId = null, broadcast = false }) {
  const { rows: [m] } = await db.query(
    `INSERT INTO messages (driver_id, sender_id, from_staff, body, order_id, broadcast) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *, (SELECT name FROM users WHERE id = $2) AS sender_name, (SELECT order_number FROM orders WHERE id = $5) AS order_number`,
    [driverId, senderId, fromStaff, body, orderId, broadcast]);
  return serialize(m);
}

const preview = (body) => (body.length > 140 ? `${body.slice(0, 137)}…` : body);
function alertDriver(driverId, body, { broadcast = false } = {}) {
  require('../push').notifyUserMessage(driverId, {
    title: broadcast ? 'Message to all drivers' : 'Message from dispatch', body: preview(body), url: '/#/driver/messages',
  }).catch((e) => console.error('Message alert failed:', e.message));
}

// Unread count for the menu badge: drivers, messages from dispatch; dispatch, messages from any driver.
router.get('/unread', asyncH(async (req, res) => {
  if (req.user.role === 'driver') {
    const { rows: [r] } = await db.query(
      'SELECT count(*)::int AS n FROM messages WHERE driver_id = $1 AND from_staff AND read_at IS NULL', [req.user.id]);
    return res.json({ unread: r.n });
  }
  if (!isStaff(req.user)) return res.json({ unread: 0 });
  const { rows: [r] } = await db.query('SELECT count(*)::int AS n FROM messages WHERE NOT from_staff AND read_at IS NULL');
  res.json({ unread: r.n });
}));

// Drivers: their conversation with dispatch, and sending to dispatch.
router.get('/me', requireRole('driver'), asyncH(async (req, res) => {
  res.json(await conversation(req.user.id, { staffReading: false }));
}));

router.post('/me', requireRole('driver'), asyncH(async (req, res) => {
  const body = bodyOf(req);
  const m = await insert({ driverId: req.user.id, senderId: req.user.id, fromStaff: false, body });
  const { rows: [u] } = await db.query('SELECT name, email FROM users WHERE id = $1', [req.user.id]);
  require('../webpush').notifyStaff('messages', {
    title: `Message from ${u.name || u.email}`, body: preview(body), url: `/#/messages/${req.user.id}`, tag: `msg-${req.user.id}`,
  });
  res.status(201).json(m);
}));

// Dispatch: every driver, with their latest message and unread count (conversations with news first).
router.get('/', staffOnly, asyncH(async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.email, u.is_online,
       last.body AS last_body, last.from_staff AS last_from_staff, last.created_at AS last_at,
       (SELECT count(*)::int FROM messages m WHERE m.driver_id = u.id AND NOT m.from_staff AND m.read_at IS NULL) AS unread
     FROM users u
     LEFT JOIN LATERAL (SELECT body, from_staff, created_at FROM messages m WHERE m.driver_id = u.id ORDER BY created_at DESC LIMIT 1) last ON true
     WHERE u.role = 'driver' AND u.is_active AND NOT u.is_demo
     ORDER BY (last.created_at IS NULL), last.created_at DESC, u.name`);
  res.json(rows.map((r) => ({
    driver: { id: r.id, name: r.name || r.email, isOnline: r.is_online }, unread: r.unread,
    last: r.last_at ? { body: r.last_body, fromStaff: r.last_from_staff, createdAt: r.last_at } : null,
  })));
}));

// Dispatch: message every active driver at once (copied into each conversation).
router.post('/broadcast', staffOnly, asyncH(async (req, res) => {
  const body = bodyOf(req);
  const { rows: drivers } = await db.query(
    "SELECT id FROM users WHERE role = 'driver' AND is_active AND NOT is_demo AND driver_status = 'approved'");
  for (const d of drivers) {
    await insert({ driverId: d.id, senderId: req.user.id, fromStaff: true, body, broadcast: true });
    alertDriver(d.id, body, { broadcast: true });
  }
  res.status(201).json({ sent: drivers.length });
}));

const driverParam = async (req) => {
  const { rows: [d] } = await db.query("SELECT id, name, email, is_online FROM users WHERE id = $1 AND role = 'driver'", [req.params.driverId])
    .catch(() => ({ rows: [] }));
  if (!d) throw new HttpError(404, 'Driver not found');
  return d;
};

router.get('/:driverId', staffOnly, asyncH(async (req, res) => {
  const d = await driverParam(req);
  res.json({ driver: { id: d.id, name: d.name || d.email, isOnline: d.is_online }, messages: await conversation(d.id, { staffReading: true }) });
}));

// Dispatch: message one driver. orderId (optional) ties it to an order ("about CD-100004").
router.post('/:driverId', staffOnly, asyncH(async (req, res) => {
  const d = await driverParam(req);
  const body = bodyOf(req);
  let orderId = str(req.body?.orderId) || null;
  if (orderId) {
    const { rows: [o] } = await db.query('SELECT id FROM orders WHERE id = $1', [orderId]).catch(() => ({ rows: [] }));
    if (!o) orderId = null;
  }
  // Replying counts as reading what they sent.
  await db.query('UPDATE messages SET read_at = now() WHERE driver_id = $1 AND NOT from_staff AND read_at IS NULL', [d.id]);
  const m = await insert({ driverId: d.id, senderId: req.user.id, fromStaff: true, body, orderId });
  alertDriver(d.id, body);
  res.status(201).json(m);
}));

module.exports = router;
