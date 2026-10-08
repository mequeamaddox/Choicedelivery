// Shared plumbing for the web app: rendering, API client, session, routing, formatting.
import { h, render } from './vendor/preact.js';
import { useState, useEffect, useCallback, useRef } from './vendor/hooks.js';
import htm from './vendor/htm.js';

export const html = htm.bind(h);
export { render, useState, useEffect, useCallback, useRef };

// ---------- Session ----------
// The API is served from this same origin, so requests use relative paths.
const TOKEN_KEY = 'cd_token';
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  remove(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

// ---------- Attribution ----------
// Where this visitor came from, so signups can be credited to the ad that brought them (src/attribution.js).
// The website passes what it remembered as ?a={...} on links here; an ad pointing straight at the app
// brings its own utm_*/click-ID parameters. Kept for 30 days; a new ad click replaces it.
const ATTR_KEY = 'cd_attribution';
const ATTR_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid', 'li_fat_id'];
function captureAttribution() {
  const q = new URLSearchParams(location.search);
  let found = null;
  try { found = q.has('a') ? JSON.parse(q.get('a')) : null; } catch { /* bad link */ }
  if (!found || typeof found !== 'object') {
    const hit = {};
    ATTR_PARAMS.forEach((k) => { if (q.get(k)) hit[k] = q.get(k).slice(0, 300); });
    if (Object.keys(hit).length) found = { ...hit, landingPage: location.pathname + location.hash, at: new Date().toISOString() };
  }
  if (found) storage.set(ATTR_KEY, JSON.stringify(found));
  // "Book This Delivery" on the website (or in an emailed quote) passes the quote as ?book={...}; the new
  // order page fills it in after the visitor signs up or logs in.
  let book = null;
  try { book = q.has('book') ? JSON.parse(q.get('book')) : null; } catch { /* bad link */ }
  if (book && typeof book === 'object') storage.set(BOOK_KEY, JSON.stringify({ ...book, at: new Date().toISOString() }));
  if (q.has('a') || q.has('book') || ATTR_PARAMS.some((k) => q.has(k))) {
    // Tidy the address bar (keeps the #/route).
    ['a', 'book', ...ATTR_PARAMS].forEach((k) => q.delete(k));
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }
}
const BOOK_KEY = 'cd_booking';
captureAttribution();

// The website quote waiting to be booked (kept for a day), or null.
export function bookingDraft() {
  try {
    const v = JSON.parse(storage.get(BOOK_KEY));
    return v && Date.now() - Date.parse(v.at) < 24 * 60 * 60 * 1000 && (v.pickupAddress || v.dropoffAddress) ? v : null;
  } catch { return null; }
}
export const clearBookingDraft = () => storage.remove(BOOK_KEY);
function attribution() {
  try {
    const v = JSON.parse(storage.get(ATTR_KEY));
    return v && Date.now() - Date.parse(v.at) < 30 * 24 * 60 * 60 * 1000 ? v : {};
  } catch { return {}; }
}

let token = storage.get(TOKEN_KEY);
let currentUser = null;
const sessionListeners = new Set();

export const getUser = () => currentUser;

export function onSessionChange(fn) {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

function setSession(newToken, user) {
  token = newToken;
  currentUser = user;
  if (newToken) storage.set(TOKEN_KEY, newToken); else storage.remove(TOKEN_KEY);
  sessionListeners.forEach((fn) => fn(user));
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith('/auth/login')) setSession(null, null);
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function restoreSession() {
  if (!token) return null;
  try {
    const { user } = await api('/auth/me');
    currentUser = user;
    return user;
  } catch {
    setSession(null, null);
    return null;
  }
}

export async function login(email, password) {
  const { token: t, user } = await api('/auth/login', { method: 'POST', body: { email, password } });
  setSession(t, user);
  return user;
}

// One-time creation of the owner (admin) account; only works while no accounts exist.
export async function createOwner(fields) {
  const { token: t, user } = await api('/auth/register', { method: 'POST', body: fields });
  setSession(t, user);
  return user;
}

// "Apply to drive": creates a driver account waiting for review and signs them in.
export async function driverSignup(fields) {
  const { token: t, user } = await api('/auth/driver-signup', { method: 'POST', body: { ...fields, attribution: attribution() } });
  setSession(t, user);
  return user;
}

export async function signup(fields) {
  const { token: t, user } = await api('/auth/signup', { method: 'POST', body: { ...fields, attribution: attribution() } });
  setSession(t, user);
  return user;
}

export function logout() {
  setSession(null, null);
  navigate('/login');
}

export function refreshUser(user) {
  currentUser = user;
  sessionListeners.forEach((fn) => fn(user));
}

export const isStaff = (u) => u && (u.role === 'admin' || u.role === 'dispatcher');

// ---------- Routing (hash based, so the server only ever serves "/") ----------
export const currentPath = () => (location.hash.replace(/^#/, '') || '/');

export function navigate(path) {
  if (currentPath() !== path) location.hash = path;
}

export function useRoute() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const onChange = () => { setPath(currentPath()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return path;
}

// Matches "/orders/:id" style patterns; returns params or null.
export function match(pattern, path) {
  const p = pattern.split('/');
  const a = path.split('?')[0].split('/');
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

// ---------- Data hooks ----------
// Loads data from the API; re-polls every `pollMs` while the tab is visible.
export function useApi(path, { pollMs } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const data = await api(path);
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState((s) => ({ data: s.data, error, loading: false }));
    }
  }, [path]);
  useEffect(() => {
    setState({ data: null, error: null, loading: true });
    load();
    if (!pollMs) return undefined;
    const id = setInterval(() => { if (!document.hidden) load(); }, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs]);
  return { ...state, reload: load };
}

// ---------- Formatting ----------
export const STATUS = {
  quote: { label: 'Saved quote', tone: 'gray' },
  pending: { label: 'Waiting for driver', tone: 'amber' },
  accepted: { label: 'Driver assigned', tone: 'blue' },
  at_pickup: { label: 'At pickup', tone: 'blue' },
  in_transit: { label: 'In transit', tone: 'violet' },
  at_dropoff: { label: 'At drop-off', tone: 'violet' },
  completed: { label: 'Delivered', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};

export const ACTIVE_STATUSES = ['accepted', 'at_pickup', 'in_transit', 'at_dropoff'];

export const PAYMENT_STATUS = {
  unpaid: { label: 'Unpaid', tone: 'amber' },
  paid: { label: 'Paid', tone: 'green' },
  invoice: { label: 'Invoiced account', tone: 'blue' },
  waived: { label: 'No charge', tone: 'gray' },
  refunded: { label: 'Refunded', tone: 'gray' },
};

// Sends the browser to Stripe's secure checkout page for an order.
export async function startCheckout(orderId) {
  const { url } = await api(`/orders/${encodeURIComponent(orderId)}/checkout`, { method: 'POST' });
  window.location.assign(url);
}

export const SERVICE_LEVEL_LABELS = { standard: 'Standard', rush: 'Rush' };
// Rush is "about 2 hours" only for local trips (up to 50 miles); longer ones take as long as the drive.
export function rushTimeText(miles) {
  if (miles == null) return 'About 2 hours for local trips';
  if (miles <= 50) return 'About 2 hours';
  return `About ${Math.ceil(((30 + (miles / 45) * 60) / 60) * 2) / 2} hours for this ${Math.round(miles)}-mile trip`;
}

export const VEHICLE_TYPES = ['Car', 'Minivan', 'Cargo Van', 'Pickup Truck'];

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(value) {
  if (!value) return '';
  const s = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return formatDate(value);
}

export const formatMoney = (cents) =>
  cents == null ? '—' : (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

export const mapsLink = (loc, address) => loc
  ? `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address || '')}`;

export const trackingUrl = (token) => `${location.origin}/#/track/${token}`;

export const ROLE_LABELS = { admin: 'Admin', dispatcher: 'Dispatcher', driver: 'Driver', shipper: 'Shipper' };
