// Location sharing while the driver is online. With "Allow all the time" location access it keeps
// running with the screen off or the app in the background (Android shows a small ongoing
// notification while it runs); otherwise it only works while the app is open.
//
// The background task also checks for new open jobs, so drivers get an alert on their phone
// without any push-notification service to set up.
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { api, getToken, storage } from './client';
import { colors } from './theme';

export const LOCATION_TASK = 'choice-driver-location';
const SEEN_JOBS_KEY = 'cd_seen_jobs';
const JOB_CHECK_MS = 45 * 1000;
let lastJobCheck = 0;
let foregroundWatch = null;

// Must be defined at startup (this file is imported by the root layout), not inside a component.
if (Platform.OS !== 'web') TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const loc = data?.locations?.[data.locations.length - 1];
  if (!loc || !(await getToken())) return;
  await api.sendLocation(loc.coords.latitude, loc.coords.longitude).catch(() => {});
  await checkForNewJobs().catch(() => {});
});

// Alerts the driver about open jobs, and jobs dispatch assigned to them, that they haven't been told
// about yet (only when the app isn't on screen; the Jobs screen shows them live otherwise).
export async function checkForNewJobs({ force = false } = {}) {
  if (!force && Date.now() - lastJobCheck < JOB_CHECK_MS) return;
  lastJobCheck = Date.now();
  const [open, mine] = await Promise.all([api.openJobs(), api.myActiveJobs()]);
  const key = (o) => o.id.slice(0, 8);
  const stored = await storage.getItemAsync(SEEN_JOBS_KEY);
  const seen = new Set(JSON.parse(stored || '[]'));
  const freshOpen = open.filter((o) => !seen.has(key(o)));
  const assigned = mine.filter((o) => !seen.has(key(o)));
  const keep = [...new Set([...open.map(key), ...mine.map(key), ...seen])].slice(0, 60);
  await storage.setItemAsync(SEEN_JOBS_KEY, JSON.stringify(keep));
  // First check after install: just remember what's there instead of alerting about all of it.
  if (stored == null || AppState.currentState === 'active') return;
  const where = (o) => {
    const from = o.stops[0]?.address?.split(',')[0] || 'Pickup';
    const to = o.stops[o.stops.length - 1]?.address?.split(',')[0] || 'Drop-off';
    const pay = o.driverPayCents != null ? `$${(o.driverPayCents / 100).toFixed(2)}` : null;
    const extras = [pay, o.distanceMiles != null ? `${o.distanceMiles} mi` : null, o.vehicleType].filter(Boolean).join(' · ');
    return `${from} → ${to}${extras ? ` · ${extras}` : ''}`;
  };
  const notify = (title, o) => Notifications.scheduleNotificationAsync({
    content: { title, body: where(o), data: { orderId: o.id }, sound: 'default' },
    trigger: { channelId: 'jobs' },
  });
  if (assigned.length) await notify('Dispatch assigned you a job', assigned[0]);
  if (freshOpen.length) {
    const o = freshOpen[0];
    await notify(freshOpen.length > 1 ? `${freshOpen.length} new jobs available` : `New ${o.serviceLevel === 'rush' ? 'RUSH ' : ''}job available`, o);
  }
}

// Returns { background: boolean } — whether sharing continues with the app closed.
export async function startTracking() {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    throw new Error('Location is off for Choice Delivery. Turn it on in your phone settings to go online.');
  }
  let background = false;
  if (Platform.OS !== 'web') try {
    background = (await Location.requestBackgroundPermissionsAsync()).status === 'granted';
  } catch { /* not available (e.g. Expo Go); fall back to foreground sharing */ }

  if (background) {
    if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false))) {
      await Location.startLocationUpdatesAsync(LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 30000,
        distanceInterval: 75,
        deferredUpdatesInterval: 30000,
        activityType: Location.ActivityType.AutomotiveNavigation,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: "You're online with Choice Delivery",
          notificationBody: 'Sharing your location with dispatch and customers. Go offline in the app to stop.',
          notificationColor: colors.teal,
          killServiceOnDestroy: false,
        },
      });
    }
  } else if (!foregroundWatch) {
    foregroundWatch = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 30000, distanceInterval: 75 },
      (loc) => { api.sendLocation(loc.coords.latitude, loc.coords.longitude).catch(() => {}); },
    );
  }
  // Send a first position right away so dispatch sees the driver immediately.
  Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    .then((loc) => api.sendLocation(loc.coords.latitude, loc.coords.longitude))
    .catch(() => {});
  return { background };
}

export async function stopTracking() {
  foregroundWatch?.remove();
  foregroundWatch = null;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
  }
}

export async function trackingState() {
  const background = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
  return { running: background || !!foregroundWatch, background };
}
