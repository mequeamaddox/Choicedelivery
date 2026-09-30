// Job alerts. Local notifications (from the location task) work with no extra setup; remote push
// notifications from the server also work once the app is built with EAS and push credentials exist.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './client';

if (Platform.OS !== 'web') Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
  }),
});

export async function setUpNotifications() {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('jobs', {
      name: 'New jobs and updates',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;
  // Remote push token (needs a real device and an EAS project id; skipped quietly otherwise).
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (Device.isDevice && projectId) {
    try {
      const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
      await api.setPushToken(data);
    } catch { /* push credentials not set up yet: local job alerts still work */ }
  }
  return true;
}

// The order a tapped notification is about (server pushes use orderId or requestId).
export const orderIdFrom = (response) => {
  const data = response?.notification?.request?.content?.data || {};
  return data.orderId || data.requestId || null;
};
