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
  if (user.role === 'driver') {
    throw new Error('Drivers use the Choice Delivery driver app. This site is for shippers and dispatch.');
  }
  setSession(t, user);
  return user;
}

// One-time creation of the owner (admin) account; only works while no accounts exist.
export async function createOwner(fields) {
  const { token: t, user } = await api('/auth/register', { method: 'POST', body: fields });
  setSession(t, user);
  return user;
}

export async function signup(fields) {
  const { token: t, user } = await api('/auth/signup', { method: 'POST', body: fields });
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
  pending: { label: 'Waiting for driver', tone: 'amber' },
  accepted: { label: 'Driver assigned', tone: 'blue' },
  at_pickup: { label: 'At pickup', tone: 'blue' },
  in_transit: { label: 'In transit', tone: 'violet' },
  at_dropoff: { label: 'At drop-off', tone: 'violet' },
  completed: { label: 'Delivered', tone: 'green' },
  cancelled: { label: 'Cancelled', tone: 'gray' },
};

export const ACTIVE_STATUSES = ['accepted', 'at_pickup', 'in_transit', 'at_dropoff'];

export const SERVICE_LEVEL_LABELS = { standard: 'Standard', rush: 'Rush (2 hours or less)' };

export const VEHICLE_TYPES = ['Car', 'Minivan', 'Cargo Van', 'Truck'];

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
