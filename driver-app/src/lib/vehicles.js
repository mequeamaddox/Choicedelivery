import { useEffect, useState } from 'react';
import { api } from './client';

const FALLBACK = ['Car', 'Minivan', 'Pickup Truck'];

// Vehicle types Choice Delivery currently runs (from the owner's rate card on the server).
export function useVehicleTypes() {
  const [types, setTypes] = useState(FALLBACK);
  useEffect(() => { api.pricing().then((p) => p.vehicleTypes?.length && setTypes(p.vehicleTypes)).catch(() => {}); }, []);
  return types;
}
