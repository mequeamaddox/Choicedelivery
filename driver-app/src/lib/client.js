// The app's API client: server address from app.json (extra.apiUrl), login token from secure storage.
// EXPO_PUBLIC_API_URL can point a development build at a test server.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { createApi } from './api';

const TOKEN_KEY = 'cd_token';
export const API_URL = String(process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl
  || 'https://app.choicedeliverysc.com').replace(/\/$/, '');

// Secure storage on phones; the browser build (used only for previews) falls back to localStorage.
export const storage = Platform.OS === 'web' ? {
  getItemAsync: async (k) => globalThis.localStorage?.getItem(k) ?? null,
  setItemAsync: async (k, v) => globalThis.localStorage?.setItem(k, v),
  deleteItemAsync: async (k) => globalThis.localStorage?.removeItem(k),
} : SecureStore;

export const getToken = () => storage.getItemAsync(TOKEN_KEY);
export const saveToken = (token) => (token ? storage.setItemAsync(TOKEN_KEY, token) : storage.deleteItemAsync(TOKEN_KEY));

let unauthorizedHandler = null;
export const onUnauthorized = (fn) => { unauthorizedHandler = fn; };

export const api = createApi({ baseUrl: API_URL, getToken, onUnauthorized: () => unauthorizedHandler?.() });
