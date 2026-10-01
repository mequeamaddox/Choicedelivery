// The phone's current position, sent when the driver arrives at or completes a stop so the server
// can check they're really at the address. Throws a readable error if location is off.
import { Platform } from 'react-native';
import * as Location from 'expo-location';

const withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

export async function currentLocation() {
  if (Platform.OS === 'web') return undefined; // the server falls back to the last shared location
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    throw new Error("Location is off for Choice Delivery. Turn it on in your phone settings so we can confirm you're at the stop.");
  }
  const fix = await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), 15000)
    || await Location.getLastKnownPositionAsync({ maxAge: 60000 });
  if (!fix) throw new Error("Couldn't get your location. Step outside or near a window and try again.");
  return {
    lat: fix.coords.latitude, lng: fix.coords.longitude,
    accuracy: fix.coords.accuracy ?? undefined, mocked: fix.mocked || undefined,
  };
}
