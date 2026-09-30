// services/pickupService.js
import { request } from '../src/api';

const POLL_INTERVAL_MS = 15000;

// Polls for pending pickups; returns an unsubscribe function.
export const listenToPendingPickups = (callback, errorCallback) => {
  let stopped = false;
  let timer;
  const poll = async () => {
    try {
      const pickups = await request('/pickups?status=pending');
      if (!stopped) callback(pickups);
    } catch (error) {
      if (!stopped && errorCallback) errorCallback(error);
    }
    if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS);
  };
  poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
};

export const getPickupById = (requestId) => request(`/pickups/${encodeURIComponent(requestId)}`);

export const acceptPickup = (requestId) =>
  request(`/pickups/${encodeURIComponent(requestId)}/accept`, { method: 'POST' });

export const updatePickupStatus = (requestId, status) =>
  request(`/pickups/${encodeURIComponent(requestId)}/status`, { method: 'POST', body: { status } });

export const confirmPickup = (requestId, { signature, image }) =>
  request(`/pickups/${encodeURIComponent(requestId)}/confirm-pickup`, {
    method: 'POST',
    body: { signature, image },
  });

export const completeDelivery = (requestId, { signature, image, printedName }) =>
  request(`/pickups/${encodeURIComponent(requestId)}/complete`, {
    method: 'POST',
    body: { signature, image, printedName },
  });

export const getMyPickups = (status) =>
  request(`/pickups/mine${status ? `?status=${encodeURIComponent(status)}` : ''}`);

export const markPickedUpByBarcode = (barcode) =>
  request('/pickups/scan', { method: 'POST', body: { barcode } });
