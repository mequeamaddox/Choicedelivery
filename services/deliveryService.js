// services/deliveryService.js
import { request } from '../src/api';
import { getMyPickups } from './pickupService';

const POLL_INTERVAL_MS = 15000;

// Polls the signed-in driver's active (not yet completed) jobs; returns an unsubscribe function.
export const listenToAssignedDeliveries = (callback, errorCallback) => {
  let stopped = false;
  let timer;
  const poll = async () => {
    try {
      const mine = await getMyPickups();
      if (!stopped) callback(mine.filter((p) => p.status.toLowerCase() !== 'completed'));
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

export const addNoteToDelivery = (deliveryId, note) =>
  request(`/pickups/${encodeURIComponent(deliveryId)}/notes`, { method: 'POST', body: { note } });
