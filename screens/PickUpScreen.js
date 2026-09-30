// src/screens/PickUpScreen.js
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { listenToPendingPickups, acceptPickup } from '../services/pickupService';

const PickUpScreen = ({ navigation }) => {
  const [pickups, setPickups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = listenToPendingPickups((pickupList) => {
      console.log('Received pickups:', pickupList);
      setPickups(pickupList);
      setLoading(false);
    }, (error) => {
      console.error("Error listening to pending pickups: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleAcceptPickup = async (requestId) => {
    try {
      await acceptPickup(requestId);
      navigation.navigate('PickUpDetail', { requestId });
      setPickups(prevPickups => prevPickups.filter(pickup => pickup.request_id !== requestId));
    } catch (error) {
      console.error("Error accepting pickup: ", error);
      Alert.alert('Error', error.message);
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
