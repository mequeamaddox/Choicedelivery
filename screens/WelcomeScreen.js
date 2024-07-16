import React, { useEffect } from 'react';
import { View, Text, Button, StyleSheet, Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

const WelcomeScreen = ({ navigation }) => {
  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    let token;
    console.log('Checking if device is physical:', Device.isDevice);
    if (Device.isDevice) {
      console.log('Device is physical');
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      console.log('Existing notification status:', existingStatus);
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
        console.log('Requested notification permissions, final status:', finalStatus);
      }
      if (finalStatus !== 'granted') {
        Alert.alert('Failed to get push token for push notification!');
        return;
      }
      token = (await Notifications.getExpoPushTokenAsync({ projectId: '57b856fd-8743-4143-99b2-be0882ffa377' })).data;
      console.log('Retrieved push token:', token);
      await AsyncStorage.setItem('expoPushToken', token);
      await AsyncStorage.setItem('welcomeShown', 'true');
      navigation.navigate('Home');
    } else {
      Alert.alert('Must use physical device for Push Notifications');
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to the App!</Text>
      <Button title="Continue" onPress={checkPermissions} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifycontent: 'center',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
});

export default WelcomeScreen;
