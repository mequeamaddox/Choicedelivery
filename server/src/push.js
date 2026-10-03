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

// Tells active drivers about an open job (online drivers only, if any are online; owners always). Each driver hears
// about a job once: when it goes back out (a driver was taken off it), only drivers who weren't alerted
// before get it, and not the driver who was removed. Owners (who drive with no payout) get every alert.
// excludeDriverId: a driver who just came off this job.
async function notifyDriversOfOrder(order, { excludeDriverId = null } = {}) {
  if (order.status !== 'pending' || order.driver) return;
  const { rows } = await db.query(
    `SELECT u.id, u.push_token, u.is_online, u.no_driver_pay,
            EXISTS (SELECT 1 FROM order_driver_alerts a WHERE a.order_id = $1 AND a.driver_id = u.id) AS alerted
     FROM users u
     WHERE u.role = 'driver' AND u.is_active AND u.driver_status = 'approved' AND NOT u.is_demo AND u.push_token IS NOT NULL`,
    [order.id]);
  const eligible = rows.filter((r) => isExpoToken(r.push_token)
    && (r.no_driver_pay || (!r.alerted && r.id !== excludeDriverId)));
  // Regular drivers: online ones if any are online. Owners: always, online or not.
  const regular = eligible.filter((r) => !r.no_driver_pay);
  const online = regular.filter((r) => r.is_online);
  const recipients = [...(online.length ? online : regular), ...eligible.filter((r) => r.no_driver_pay)];
  if (!recipients.length) return;
  const { rows: [pay] } = await db.query('SELECT driver_pay_cents FROM orders WHERE id = $1', [order.id]);
  const payText = pay?.driver_pay_cents != null ? `$${(pay.driver_pay_cents / 100).toFixed(2)} · ` : '';
  const pickup = order.stops.find((s) => s.type === 'pickup');
  const dropoff = [...order.stops].reverse().find((s) => s.type === 'dropoff');
  await sendExpo(recipients.map((r) => ({
    to: r.push_token,
    sound: 'default',
    channelId: 'jobs', // the driver app's high-priority Android channel
    title: order.serviceLevel === 'rush' ? 'New RUSH job available' : 'New job available',
    body: `${payText}${order.distanceMiles != null ? `${order.distanceMiles} mi · ` : ''}${pickup?.address} → ${dropoff?.address}`,
    data: { orderId: order.id, requestId: order.id },
  })));
  await db.query(
    `INSERT INTO order_driver_alerts (order_id, driver_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
    [order.id, recipients.map((r) => r.id)]);
}

async function notifyUser(userId, title, body, data = {}) {
  const { rows } = await db.query('SELECT push_token FROM users WHERE id = $1', [userId]);
  if (isExpoToken(rows[0]?.push_token)) {
    await sendExpo([{ to: rows[0].push_token, sound: 'default', channelId: 'jobs', title, body, data }]);
  }
}

module.exports = { notifyDriversOfOrder, notifyUser };
