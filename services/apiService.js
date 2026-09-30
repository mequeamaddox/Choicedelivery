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
  await clearSession();
};

export const sendPasswordResetEmail = (email) =>
  request('/auth/forgot-password', { method: 'POST', body: { email }, auth: false });

// Admin-only once the first account exists.
export const registerUser = (email, password, role = 'driver') =>
  request('/auth/register', { method: 'POST', body: { email, password, role } });

export const checkServer = () => request('/health', { auth: false });

export const getDriverProfile = () => request('/drivers/me');

export const updateDriverProfile = (profile) =>
  request('/drivers/me', { method: 'PUT', body: profile });

export const savePushToken = (token) =>
  request('/drivers/me/push-token', { method: 'PUT', body: { token } });
