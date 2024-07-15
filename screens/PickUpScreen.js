// src/screens/PickUpScreen.js
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { listenToPendingPickups, updatePickupStatus } from '../services/pickupService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDatabase, ref, get } from 'firebase/database';

const PickUpScreen = ({ navigation }) => {
  const [pickups, setPickups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = listenToPendingPickups((pickupList) => {
      console.log('Received pickups:', pickupList);
      setPickups(pickupList);
      setLoading(false);
      checkForNewPickups(pickupList);
    }, (error) => {
      console.error("Error listening to pending pickups: ", error);
    });

    return () => unsubscribe();
  }, []);

  const checkForNewPickups = async (newPickups) => {
    const lastChecked = await AsyncStorage.getItem('lastChecked');
    const newPickupsCount = newPickups.filter(
      (pickup) => !lastChecked || new Date(pickup.pickup_date) > new Date(lastChecked)
    ).length;

    if (newPickupsCount > 0) {
      await AsyncStorage.setItem('lastChecked', new Date().toISOString());
      sendPushNotification(newPickups[0], newPickupsCount);
    }
  };

  const sendPushNotification = async (pickup, count) => {
    const notificationsEnabled = await AsyncStorage.getItem('notificationsEnabled');
    if (notificationsEnabled === 'false') {
      return;
    }

    const doNotDisturbEnabled = await AsyncStorage.getItem('doNotDisturbEnabled');
    if (doNotDisturbEnabled === 'true') {
      const doNotDisturbStart = new Date(await AsyncStorage.getItem('doNotDisturbStart'));
      const doNotDisturbEnd = new Date(await AsyncStorage.getItem('doNotDisturbEnd'));
      const now = new Date();
      if (now >= doNotDisturbStart && now <= doNotDisturbEnd) {
        return;
      }
    }
  
    const token = await AsyncStorage.getItem('expoPushToken');
    if (token) {
      const message = {
        to: token,
        sound: 'default',
        title: 'New Pickup Request',
        body: `You have ${count} new pickup request(s) from ${pickup.contact_name} at ${pickup.pickup_address} to ${pickup.destination_address}`,
        data: { requestId: pickup.request_id },
      };
      console.log('Sending notification with message:', message);
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });
    } else {
      console.log('No push token found');
    }
  };

  const handleAcceptPickup = async (requestId) => {
    try {
      const db = getDatabase();
      const pickupRef = ref(db, `pickups/${requestId}`);
      const snapshot = await get(pickupRef);
      if (snapshot.exists()) {
        const pickupData = snapshot.val();
        await updatePickupStatus(requestId, 'Accepted');
        navigation.navigate('PickUpDetail', { requestId });
        setPickups(prevPickups => prevPickups.map(pickup =>
          pickup.request_id === requestId ? { ...pickup, status: 'Accepted' } : pickup
        ));
      } else {
        console.error("Pickup not found");
      }
    } catch (error) {
      console.error("Error updating pickup status: ", error);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={pickups}
        keyExtractor={(item) => item.request_id}
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={styles.title}>{item.contact_name}</Text>
            <Text>Status: {item.status}</Text>
            <Text>Pickup Address: {item.pickup_address}</Text>
            <Text>Delivery Address: {item.destination_address}</Text>
            <Text>Weight: {item.weight}</Text>
            <Text>Number of Pieces: {item.number_of_pieces}</Text>
            <Text>Requested Vehicle Type: {item.vehicle_type}</Text>
            {item.status.toLowerCase() === 'pending' && (
              <TouchableOpacity
                style={styles.button}
                onPress={() => handleAcceptPickup(item.request_id)}
              >
                <Text style={styles.buttonText}>Accept Pickup</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  item: {
    padding: 16,
    marginBottom: 16,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#6200ee',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
  },
});

export default PickUpScreen;
