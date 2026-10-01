// Talks to the Choice Delivery server (the same API the website uses). Plain JavaScript with no
// React Native imports, so it also runs in the Node tests and in the background location task.
export const ACTIVE_STATUSES = ['accepted', 'at_pickup', 'in_transit', 'at_dropoff'];

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// baseUrl: server address. getToken: async () => saved login token. onUnauthorized: called on 401.
export function createApi({ baseUrl, getToken, onUnauthorized, fetchImpl = fetch }) {
  async function request(path, { method = 'GET', body, timeoutMs = 20000 } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
      });
    } catch (e) {
      throw new ApiError(e?.name === 'AbortError'
        ? 'The server took too long to answer. Check your signal and try again.'
        : "Can't reach Choice Delivery. Check your internet connection.", 0);
    } finally {
      clearTimeout(timer);
    }
    const data = res.status === 204 ? null : await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && token && !path.startsWith('/auth/login')) onUnauthorized?.();
      throw new ApiError(data?.message || `Request failed (${res.status})`, res.status);
    }
    return data;
  }

  return {
    request,
    login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
    // Apply to drive: { name, email, password, phoneNumber, city, zip, vehicle: {...}, agreed: true }
    driverSignup: (fields) => request('/auth/driver-signup', { method: 'POST', body: fields }),
    changePassword: (currentPassword, newPassword) => request('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
    // kind: photo | license_front | license_back | insurance | vehicle | registration; data: image data URL
    uploadDocument: (kind, data) => request(`/users/me/documents/${kind}`, { method: 'PUT', body: { data }, timeoutMs: 60000 }),
    document: (userId, kind) => request(`/users/${encodeURIComponent(userId)}/documents/${kind}`),
    forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
    me: () => request('/users/me'),
    updateMe: (fields) => request('/users/me', { method: 'PUT', body: fields }),
    setOnline: (online) => request('/users/me/availability', { method: 'PUT', body: { online } }),
    sendLocation: (lat, lng) => request('/users/me/location', { method: 'PUT', body: { lat, lng } }),
    setPushToken: (token) => request('/users/me/push-token', { method: 'PUT', body: { token } }),
    myActiveJobs: () => request(`/orders?mine=true&status=${ACTIVE_STATUSES.join(',')}`),
    // Open jobs any driver can take (the server already hides unpaid and demo orders from drivers).
    openJobs: async () => (await request('/orders?status=pending')).filter((o) => !o.driver),
    history: () => request('/orders?mine=true&status=completed&limit=100'),
    // { owedCents, last7DaysCents, paidLast60DaysCents, orders }
    earnings: () => request('/payouts/me'),
    job: (id) => request(`/orders/${encodeURIComponent(id)}`),
    accept: (id) => request(`/orders/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
    // location: { lat, lng, accuracy?, mocked? } from the phone; the driver must be at the stop.
    arrive: (id, stopId, location) => request(`/orders/${encodeURIComponent(id)}/stops/${encodeURIComponent(stopId)}/arrive`,
      { method: 'POST', body: { location } }),
    // proof: { signature?, photo?, printedName?, location } (signature/photo are data URLs).
    // Drop-offs need both a photo and a signature; pickups need at least one.
    complete: (id, stopId, proof) => request(
      `/orders/${encodeURIComponent(id)}/stops/${encodeURIComponent(stopId)}/complete`,
      { method: 'POST', body: proof, timeoutMs: 60000 }),
    addNote: (id, note) => request(`/orders/${encodeURIComponent(id)}/notes`, { method: 'POST', body: { note } }),
    scan: (barcode) => request('/orders/scan', { method: 'POST', body: { barcode } }),
    pricing: () => request('/public/pricing'),
  };
}

// The first stop that isn't done yet: stops must be handled in route order.
export const nextStop = (order) => order.stops.find((s) => s.status !== 'completed') || null;

export const mapsUrl = (stop) => `https://www.google.com/maps/dir/?api=1&destination=${
  stop.location ? `${stop.location.lat},${stop.location.lng}` : encodeURIComponent(stop.address)}`;

export const formatMoney = (cents) => (cents == null ? '—' : `$${(cents / 100).toFixed(2)}`);

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

export function minutesSince(value, now = Date.now()) {
  return value ? Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000)) : 0;
}
