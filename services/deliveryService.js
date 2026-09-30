// services/deliveryService.js
import { request } from '../src/api';
import { getMyPickups } from './pickupService';

const POLL_INTERVAL_MS = 15000;

// Polls the signed-in driver's jobs that are underway; returns an unsubscribe function.
export const listenToAssignedDeliveries = (callback, errorCallback) => {
  let stopped = false;
  let timer;
  const poll = async () => {
    try {
      const mine = await getMyPickups('accepted,at_pickup,in_transit,at_dropoff');
      if (!stopped) callback(mine);
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
  request(`/orders/${encodeURIComponent(deliveryId)}/notes`, { method: 'POST', body: { note } });
