// Root: sign-in gate, background location task, notification taps.
import '../lib/tracking'; // defines the background location task at startup
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from '../lib/auth';
import { setUpNotifications, orderIdFrom } from '../lib/notifications';
import { startTracking } from '../lib/tracking';
import { colors } from '../lib/theme';
import { Loading } from '../components/ui';

// Tapped-notification hook (phones only; the browser preview has no notifications).
const useLastNotificationResponse = Platform.OS === 'web' ? () => null : Notifications.useLastNotificationResponse;

function Gate() {
  const { loading, user } = useAuth();
  const router = useRouter();
  const lastResponse = useLastNotificationResponse();

  useEffect(() => {
    if (!user) return;
    setUpNotifications().catch(() => {});
    // Back online after the phone restarted or the app was closed: resume sharing location.
    if (user.isOnline && !user.workBlocker) startTracking().catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    const id = user && orderIdFrom(lastResponse);
    if (id) router.push(`/job/${id}`);
  }, [lastResponse, user?.id]);

  if (loading) return <Loading />;
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: colors.teal }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '700' },
      contentStyle: { backgroundColor: colors.bg },
    }}>
      <Stack.Protected guard={!!user}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="job/[id]" options={{ title: 'Job' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan barcode', presentation: 'modal' }} />
        <Stack.Screen name="profile" options={{ title: 'Your profile' }} />
        <Stack.Screen name="password" options={{ title: 'Change password' }} />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="forgot" options={{ title: 'Reset password' }} />
        <Stack.Screen name="apply" options={{ title: 'Apply to drive' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Gate />
    </AuthProvider>
  );
}
