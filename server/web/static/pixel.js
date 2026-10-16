// Meta (Facebook) Pixel in the booking app: only customer signups, driver applications and booked
// orders are sent, so Facebook ads can be measured. No page views, so order pages and addresses are
// never sent. The Pixel script loads the first time one of these happens. Website: landing/pixel.js.
const PIXEL_ID = '2958062107867171';

function load() {
  if (window.fbq) return window.fbq;
  const n = function (...args) { n.callMethod ? n.callMethod(...args) : n.queue.push(args); };
  window.fbq = n; if (!window._fbq) window._fbq = n;
  n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
  const s = document.createElement('script');
  s.async = true; s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(s);
  n('set', 'autoConfig', false, PIXEL_ID); // don't let it read buttons or page content in the app
  n('init', PIXEL_ID);
  return n;
}

export function trackPixel(event, params = {}) {
  try { load()('track', event, { currency: 'USD', ...params }); } catch { /* blocked: never break the app */ }
}

// A booked order counts once (the order page can be opened again after paying).
export function trackPurchase(order) {
  const key = `cd_px_${order.id}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* private mode */ }
  trackPixel('Purchase', { value: (order.priceCents || 0) / 100, content_name: order.serviceLevel === 'rush' ? 'Rush delivery' : 'Delivery' });
}
