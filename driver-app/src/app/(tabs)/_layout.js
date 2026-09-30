import { Tabs } from 'expo-router/js-tabs';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';

const icon = (name) => ({ color, size }) => <Ionicons name={name} color={color} size={size} />;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerStyle: { backgroundColor: colors.teal }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '700' },
      tabBarActiveTintColor: colors.teal, tabBarInactiveTintColor: colors.muted,
      sceneStyle: { backgroundColor: colors.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Jobs', tabBarIcon: icon('car-outline') }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: icon('time-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('person-outline') }} />
    </Tabs>
  );
}
