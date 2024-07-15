import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import HomeScreen from './screens/HomeScreen';
import DetailsScreen from './screens/DetailsScreen';
import SignatureCaptureScreen from './screens/SignatureCaptureScreen';

const Stack = createStackNavigator();

const HomeStackNavigator = () => (
  <Stack.Navigator
    screenOptions={{
      headerStyle: { backgroundColor: '#6200ee' },
      headerTintColor: '#fff',
      headerTitleStyle: { fontWeight: 'bold' },
    }}
  >
    <Stack.Screen
      name="Home"
      component={HomeScreen}
      options={{ title: 'Home' }}
    />
    <Stack.Screen name="Details" component={DetailsScreen} />
    <Stack.Screen name="SignatureCapture" component={SignatureCaptureScreen} />
  </Stack.Navigator>
);

export default HomeStackNavigator;
