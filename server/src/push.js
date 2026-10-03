const db = require('./db');

async function sendExpo(messages) {
  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < messages.length; i += 100) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
    if (!res.ok) console.error('Expo push failed:', res.status, await res.text());
  }
}

const isExpoToken = (t) => typeof t === 'string' && t.startsWith('ExponentPushToken');

// Tells active drivers about a new open job (online drivers only, if any are online).
// excludeDriverId: a driver who just came off this job (not re-offered it).
async function notifyDriversOfOrder(order, { excludeDriverId = null } = {}) {
  if (order.status !== 'pending' || order.driver) return;
  const { rows } = await db.query(
    `SELECT push_token, is_online FROM users
     WHERE role = 'driver' AND is_active AND driver_status = 'approved' AND NOT is_demo AND push_token IS NOT NULL
       AND id IS DISTINCT FROM $1`, [excludeDriverId]);
  const online = rows.filter((r) => r.is_online);
  const targets = (online.length ? online : rows).map((r) => r.push_token).filter(isExpoToken);
  const { rows: [pay] } = await db.query('SELECT driver_pay_cents FROM orders WHERE id = $1', [order.id]);
  const payText = pay?.driver_pay_cents != null ? `$${(pay.driver_pay_cents / 100).toFixed(2)} · ` : '';
  const pickup = order.stops.find((s) => s.type === 'pickup');
  const dropoff = [...order.stops].reverse().find((s) => s.type === 'dropoff');
  await sendExpo(targets.map((to) => ({
    to,
    sound: 'default',
    channelId: 'jobs', // the driver app's high-priority Android channel
    title: order.serviceLevel === 'rush' ? 'New RUSH job available' : 'New job available',
    body: `${payText}${order.distanceMiles != null ? `${order.distanceMiles} mi · ` : ''}${pickup?.address} → ${dropoff?.address}`,
    data: { orderId: order.id, requestId: order.id },
  })));
}

async function notifyUser(userId, title, body, data = {}) {
  const { rows } = await db.query('SELECT push_token FROM users WHERE id = $1', [userId]);
  if (isExpoToken(rows[0]?.push_token)) {
    await sendExpo([{ to: rows[0].push_token, sound: 'default', channelId: 'jobs', title, body, data }]);
  }
}

module.exports = { notifyDriversOfOrder, notifyUser };
