// services/pickupService.js
// The API models jobs as orders with ordered pickup/drop-off stops. The driver screens were
// built around a single pickup -> drop-off record, so toPickup() adapts an order to that shape.
import { request } from '../src/api';

const POLL_INTERVAL_MS = 15000;

const STATUS_LABELS = {
  pending: 'Pending',
  accepted: 'Accepted',
  at_pickup: 'At Pickup',
  in_transit: 'In Transit',
  at_dropoff: 'At Drop-off',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const toPickup = (order) => {
  const pickup = order.stops.find((s) => s.type === 'pickup') || {};
  const dropoff = [...order.stops].reverse().find((s) => s.type === 'dropoff') || {};
  return {
    ...order,
    request_id: order.id,
    status: STATUS_LABELS[order.status] || order.status,
    order_number: order.orderNumber,
    contact_name: pickup.contactName || dropoff.contactName,
    contact_phone: pickup.contactPhone || dropoff.contactPhone,
    recipient_name: dropoff.contactName,
    recipient_phone: dropoff.contactPhone,
    pickup_address: pickup.address,
    destination_address: dropoff.address,
    pickup_location: pickup.location,
    delivery_location: dropoff.location,
    pickup_instructions: pickup.instructions,
    delivery_instructions: dropoff.instructions,
    weight: order.weight,
    number_of_pieces: order.numberOfPieces,
    vehicle_type: order.vehicleType,
    pickup_date: order.scheduledAt || order.createdAt,
    delivered_at: order.completedAt,
  };
};

const orderPath = (id) => `/orders/${encodeURIComponent(id)}`;

// Polls for open jobs; returns an unsubscribe function.
export const listenToPendingPickups = (callback, errorCallback) => {
  let stopped = false;
  let timer;
  const poll = async () => {
    try {
      const orders = await request('/orders?status=pending');
      if (!stopped) callback(orders.map(toPickup));
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

export const getPickupById = async (id) => toPickup(await request(orderPath(id)));

export const acceptPickup = async (id) => toPickup(await request(`${orderPath(id)}/accept`, { method: 'POST' }));

// The next stop of the given type that hasn't been completed yet.
const nextStopOfType = async (id, type) => {
  const order = await request(orderPath(id));
  const stop = order.stops.find((s) => s.status !== 'completed');
  if (!stop || stop.type !== type) {
    throw new Error(type === 'pickup' ? 'This job has already been picked up' : 'Finish the pickup first');
  }
  return stop;
};

const arriveAt = async (id, type) => {
  const stop = await nextStopOfType(id, type);
  return toPickup(await request(`${orderPath(id)}/stops/${stop.id}/arrive`, { method: 'POST' }));
};

const completeAt = async (id, type, { signature, image, printedName }) => {
  const stop = await nextStopOfType(id, type);
  return toPickup(await request(`${orderPath(id)}/stops/${stop.id}/complete`, {
    method: 'POST',
    body: { signature: signature || undefined, photo: image || undefined, printedName },
  }));
};

export const arriveAtPickup = (id) => arriveAt(id, 'pickup');
export const arriveAtDropoff = (id) => arriveAt(id, 'dropoff');
export const confirmPickup = (id, proof) => completeAt(id, 'pickup', proof);
export const completeDelivery = (id, proof) => completeAt(id, 'dropoff', proof);

// The signed-in driver's jobs, optionally filtered by API status (e.g. 'completed').
export const getMyPickups = async (status) => {
  const orders = await request(`/orders?mine=true${status ? `&status=${encodeURIComponent(status)}` : ''}`);
  return orders.map(toPickup);
};

export const markPickedUpByBarcode = async (barcode) =>
  toPickup(await request('/orders/scan', { method: 'POST', body: { barcode } }));
