// src/api.js — client for the Choice Delivery API (server/ in this repo, hosted on Railway).
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Set EXPO_PUBLIC_API_URL (e.g. in .env or EAS env) or "extra.apiUrl" in app.json.
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  Constants.expoConfig?.extra?.apiUrl ||
  ''
).replace(/\/$/, '');

const TOKEN_KEY = 'authToken';
const USER_KEY = 'authUser';

let session = { token: null, user: null };
const listeners = new Set();

const emit = () => listeners.forEach((cb) => cb(session.user));

// Restores the saved session, then calls back with the signed-in user (or null) now and on every change.
export function onAuthStateChanged(callback) {
  listeners.add(callback);
  restoreSession().then(() => callback(session.user));
  return () => listeners.delete(callback);
}

let restoring;
function restoreSession() {
  if (!restoring) {
    restoring = (async () => {
      const [[, token], [, user]] = await AsyncStorage.multiGet([TOKEN_KEY, USER_KEY]);
      if (token && user) session = { token, user: JSON.parse(user) };
    })().catch(() => {});
  }
  return restoring;
}

export async function setSession(token, user) {
  session = { token, user };
  await AsyncStorage.multiSet([[TOKEN_KEY, token], [USER_KEY, JSON.stringify(user)]]);
  emit();
}

export async function clearSession() {
  session = { token: null, user: null };
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
  emit();
}

export const getCurrentUser = () => session.user;

export async function request(path, { method = 'GET', body, auth = true } = {}) {
  if (!API_URL) throw new Error('API URL is not configured. Set EXPO_PUBLIC_API_URL.');
  await restoreSession();
  const headers = { 'Content-Type': 'application/json' };
  if (auth && session.token) headers.Authorization = `Bearer ${session.token}`;

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && auth) await clearSession();
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}
