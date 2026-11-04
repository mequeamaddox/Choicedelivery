// Choice Dispatch / Choice Delivery home-screen app: shows phone alerts and opens the order when tapped.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch { m = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(m.title || 'Choice Dispatch', {
    body: m.body || '',
    icon: '/static/app-icon-192.png',
    badge: '/static/app-badge.png',
    tag: m.tag || undefined,
    renotify: !!m.tag,
    data: { url: m.url || '/#/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/#/', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = open.find((c) => new URL(c.url).origin === self.location.origin);
    if (win) { await win.focus(); return win.navigate(url).catch(() => null); }
    return self.clients.openWindow(url);
  })());
});
