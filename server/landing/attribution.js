// Remembers where a visitor came from (ad click IDs, utm_* tags, referring site) so the website's
// forms, and signups in the app, can be credited to the ad or source that brought them.
// Kept in this browser for 30 days; a new ad click or tagged link replaces it. See src/attribution.js.
(function () {
  var KEY = 'cd_attribution';
  var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  var PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid', 'li_fat_id'];
  var APP_HOST = 'app.choicedeliverysc.com';

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY));
      return v && Date.now() - Date.parse(v.at) < MAX_AGE_MS ? v : null;
    } catch (e) { return null; }
  }
  function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } }

  var current = read();
  var query = new URLSearchParams(location.search);
  var hit = {};
  PARAMS.forEach(function (k) { var v = query.get(k); if (v) hit[k] = v.slice(0, 300); });
  var referrer = '';
  try {
    if (document.referrer && !/(^|\.)choicedeliverysc\.com$/.test(new URL(document.referrer).hostname)) referrer = document.referrer;
  } catch (e) { /* bad referrer */ }
  // An ad click or tagged link always counts; a plain link from another site only if nothing is remembered.
  if (Object.keys(hit).length || (referrer && !current)) {
    if (referrer) hit.referrer = referrer.slice(0, 300);
    hit.landingPage = location.pathname;
    hit.at = new Date().toISOString();
    current = hit;
    write(current);
  }

  window.cdAttribution = function () { return current || {}; };

  // The app is on another domain (its own storage), so links to it carry the attribution along.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || !current) return;
    try {
      var url = new URL(a.href);
      if (url.hostname !== APP_HOST || url.searchParams.has('a')) return;
      url.searchParams.set('a', JSON.stringify(current));
      a.href = url.toString();
    } catch (err) { /* leave the link alone */ }
  }, true);
})();
