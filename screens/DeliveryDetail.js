// src/screens/DeliveryDetail.js
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { getDatabase, ref, get } from 'firebase/database';

const DeliveryDetail = ({ route }) => {
  const { deliveryId } = route.params;
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDelivery = async () => {
      try {
        const db = getDatabase();
        const deliveryRef = ref(db, `pickups/${deliveryId}`);
        const snapshot = await get(deliveryRef);

        if (snapshot.exists()) {
          setDelivery({ id: snapshot.key, ...snapshot.val() });
        } else {
          console.error('Delivery not found');
        }
      } catch (error) {
        console.error('Failed to fetch delivery:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDelivery();
  }, [deliveryId]);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!delivery) {
    return <Text>Delivery not found.</Text>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.item}>
        <Text style={styles.title}>{delivery.contact_name}</Text>
        <Text style={styles.detail}>Status: {delivery.status}</Text>
        <Text style={styles.detail}>Delivery Address: {delivery.destination_address}</Text>
        <Text style={styles.detail}>Weight: {delivery.weight}</Text>
        <Text style={styles.detail}>Number of Pieces: {delivery.number_of_pieces}</Text>
        <Text style={styles.detail}>Pickup Address: {delivery.pickup_address}</Text>
        <Text style={styles.detail}>Delivered At: {delivery.deliveryTimestamp ? new Date(delivery.deliveryTimestamp).toString() : 'Not delivered yet'}</Text>
      </View>
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
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  detail: {
    fontSize: 16,
    marginBottom: 8,
  },
});

export default DeliveryDetail;
