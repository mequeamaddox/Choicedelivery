// services/pickupService.js
import { getDatabase, ref, onValue, get, update, set } from 'firebase/database';

export const listenToPendingPickups = (callback, errorCallback) => {
  const db = getDatabase();
  const pickupsRef = ref(db, 'pickups');
  const unsubscribe = onValue(pickupsRef, (snapshot) => {
    const data = snapshot.val();
    const pendingPickups = Object.keys(data || {}).map(key => ({ requestId: key, ...data[key] })).filter(pickup => pickup.status.toLowerCase() === 'pending');
    callback(pendingPickups);
  }, errorCallback);
  return unsubscribe;
};

export const updatePickupStatus = async (requestId, status) => {
  const db = getDatabase();
  const pickupRef = ref(db, `pickups/${requestId}`);
  await update(pickupRef, { status });
};

export const getPickupById = async (requestId) => {
  try {
    const db = getDatabase();
    const pickupRef = ref(db, `pickups/${requestId}`);
    const snapshot = await get(pickupRef);
    if (snapshot.exists()) {
      return snapshot.val();
    } else {
      throw new Error('Pickup not found');
    }
  } catch (error) {
    throw new Error('Error getting pickup by ID: ' + error.message);
  }
};


