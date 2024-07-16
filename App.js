import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { createStackNavigator } from '@react-navigation/stack';
import { ThemeProvider } from 'styled-components/native';
import { Alert, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { auth } from './src/firebaseConfig';
import { theme } from './src/theme';
import LottieAnimation from './src/LottieAnimation'; 

import HomeScreen from './screens/HomeScreen';
import PickUpScreen from './screens/PickUpScreen';
import PickUpDetail from './screens/PickUpDetail';
import DeliveryHistory from './screens/DeliveryHistory';
import DeliveryDetail from './screens/DeliveryDetail';
import LoginScreen from './screens/LoginScreen';
import DriverProfileScreen from './screens/DriverProfileScreen';
import WelcomeScreen from './screens/WelcomeScreen';
import DeliveryOverview from './screens/DeliveryOverview';
import DeliveryScreen from './screens/DeliveryScreen';
import ConfirmPickupScreen from './screens/ConfirmPickupScreen';
import SettingsScreen from './screens/SettingsScreen'; 
import NotificationSettingsScreen from './screens/NotificationSettingsScreen';
import AppPreferencesScreen from './screens/AppPreferencesScreen';
import AboutAppScreen from './screens/AboutAppScreen';

const Stack = createStackNavigator();
const Drawer = createDrawerNavigator();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

function PickUpStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Pickups" component={PickUpScreen } options={{ headerShown: false }} />
      <Stack.Screen name="PickUpDetail" component={PickUpDetail} options={{ headerShown: false }} />
      <Stack.Screen name="ConfirmPickup" component={ConfirmPickupScreen} options={{ headerShown: false }} /> 
      <Stack.Screen name="DeliveryOverview" component={DeliveryOverview} options={{ headerShown: false }} />
      <Stack.Screen name="DeliveryScreen" component={DeliveryScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function DeliveryStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="DeliveryHistory" component={DeliveryHistory} options={{ headerShown: false }} />
      <Stack.Screen name="DeliveryDetail" component={DeliveryDetail} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator initialRouteName="Login" options={{ headerShown: false }} >
      <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
    </Stack.Navigator>
  );
}

function SettingsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="User Settings" component={SettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AppPreferences" component={AppPreferencesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="AboutApp" component={AboutAppScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [isTransitioning, setIsTransitioning] = useState(true); // State to manage animation visibility

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setUser(user);
      } else {
        setUser(null);
      }
      setIsTransitioning(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    return () => subscription.remove();
  }, []);

  const handleNavigationChange = () => {
    setIsTransitioning(true);
    setTimeout(() => setIsTransitioning(false), 1000); // Adjust the duration to match your animation length
  };

  return (
    <ThemeProvider theme={theme}>
      <NavigationContainer onStateChange={handleNavigationChange}>
        <LottieAnimation isVisible={isTransitioning} />
        {!user ? (
          <AuthStack />
        ) : (
          <Drawer.Navigator initialRouteName="Home">
            <Drawer.Screen name="Home" component={HomeScreen} />
            <Drawer.Screen name="PickUps" component={PickUpStack} />
            <Drawer.Screen name="Completed Deliveries" component={DeliveryStack} />
            <Drawer.Screen name="Profile" component={DriverProfileScreen} />
            <Drawer.Screen name="Settings" component={SettingsStack} />
          </Drawer.Navigator>
        )}
      </NavigationContainer>
    </ThemeProvider>
  );
}
