// Meta (Facebook) Pixel for the public website: page views plus the key actions (getting a quote,
// emailing a quote, starting to book, sending a message), so Facebook ads can be measured and aimed at
// people likely to book. The booking app sends signups and paid orders (web/static/pixel.js).
(function () {
  var PIXEL_ID = '2958062107867171';
  /* eslint-disable */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');
  // cdTrack('Lead', { value: 12.5 }) from the page's own scripts; never breaks the page if blocked.
  window.cdTrack = function (event, params) {
    try { fbq('track', event, Object.assign({ currency: 'USD' }, params || {})); } catch (e) { /* blocked */ }
  };
})();
