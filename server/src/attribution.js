// Visitor attribution: where someone came from before they sent a form or signed up.
// The website (landing/attribution.js) and the web app (web/static/lib.js) remember the ad click ID,
// utm_* tags and referring site from the visitor's first page and send them as `attribution`
// with each form. Values come from the browser, so they're only trusted as labels.
const db = require('./db');

const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid', 'li_fat_id', 'referrer', 'landingPage', 'at'];

// A short label for reports: facebook, google_ads, a utm_source, a referring site, or direct.
// fbclid is added to every Facebook/Instagram link click (ads and ordinary posts); utm_medium
// (e.g. "paid") tells them apart when the ad's link has utm tags.
function channelOf(a) {
  if (!a) return 'direct';
  const src = (a.utm_source || '').toLowerCase();
  if (a.fbclid || /^(fb|facebook|ig|instagram|meta)\b/.test(src)) return 'facebook';
  if (a.gclid || a.gbraid || a.wbraid) return 'google_ads';
  if (a.msclkid) return 'bing_ads';
  if (a.ttclid) return 'tiktok';
  if (a.li_fat_id) return 'linkedin';
  if (src) return src.slice(0, 60);
  if (a.referrer) {
    try { return new URL(a.referrer).hostname.replace(/^www\./, '').slice(0, 60); } catch { return 'referral'; }
  }
  return 'direct';
}

// Keeps the known keys as short strings; null when nothing useful was sent.
function cleanAttribution(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const k of KEYS) {
    if (typeof raw[k] === 'string' && raw[k].trim()) out[k] = raw[k].trim().slice(0, 300);
  }
  if (!Object.keys(out).length) return null;
  out.channel = channelOf(out);
  return out;
}

// Records a website action. Never fails the request it belongs to.
async function logEvent(kind, attribution, details = null) {
  try {
    await db.query('INSERT INTO site_events (kind, channel, attribution, details) VALUES ($1, $2, $3, $4)',
      [kind, attribution?.channel || 'direct', attribution, details]);
  } catch (e) {
    console.error('Site event failed:', e.message);
  }
}

module.exports = { cleanAttribution, channelOf, logEvent };
