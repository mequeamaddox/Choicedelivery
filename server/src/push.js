const db = require('./db');

// Notifies every driver with a registered Expo push token about a new pickup.
async function notifyDriversOfPickup(pickup) {
  const { rows } = await db.query("SELECT push_token FROM users WHERE push_token LIKE 'ExponentPushToken%'");
  if (!rows.length) return;
  const messages = rows.map((r) => ({
    to: r.push_token,
    sound: 'default',
    title: 'New Pickup Request',
    body: `${pickup.contact_name || 'New pickup'} at ${pickup.pickup_address} to ${pickup.destination_address}`,
    data: { requestId: pickup.id },
  }));
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

module.exports = { notifyDriversOfPickup };
