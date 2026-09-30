import { request, setSession, clearSession } from '../src/api';

export const login = async (email, password) => {
  const { token, user } = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  await setSession(token, user);
  return user;
};

export const logout = async () => {
  // Best effort: stop offering jobs to this device once the driver signs out.
  await request('/users/me/availability', { method: 'PUT', body: { online: false } }).catch(() => {});
  await request('/users/me/push-token', { method: 'PUT', body: { token: null } }).catch(() => {});
  await clearSession();
};

export const sendPasswordResetEmail = (email) =>
  request('/auth/forgot-password', { method: 'POST', body: { email }, auth: false });

// Admin-only once the first account exists.
export const registerUser = (email, password, role = 'driver') =>
  request('/auth/register', { method: 'POST', body: { email, password, role } });

export const checkServer = () => request('/health', { auth: false });

export const getDriverProfile = () => request('/users/me');

export const updateDriverProfile = (profile) =>
  request('/users/me', { method: 'PUT', body: profile });

export const savePushToken = (token) =>
  request('/users/me/push-token', { method: 'PUT', body: { token } });

// Lets dispatch and shippers see where the driver is.
export const updateLocation = (latitude, longitude) =>
  request('/users/me/location', { method: 'PUT', body: { lat: latitude, lng: longitude } });

export const setAvailability = (online) =>
  request('/users/me/availability', { method: 'PUT', body: { online } });
