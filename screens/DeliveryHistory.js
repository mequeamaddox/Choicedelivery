import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, TouchableOpacity } from 'react-native';
import { getMyPickups } from '../services/pickupService';

const DeliveryHistory = ({ navigation }) => {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDeliveries = async () => {
      try {
        setDeliveries(await getMyPickups('Completed'));
      } catch (error) {
        console.error('Failed to fetch deliveries:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDeliveries();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {deliveries.length === 0 ? (
        <Text>No deliveries found</Text>
      ) : (
        <FlatList
          data={deliveries}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.item}
              onPress={() => navigation.navigate('DeliveryDetail', { deliveryId: item.id })}
            >
              <Text style={styles.title}>{item.contact_name}</Text>
              <Text>Status: {item.status}</Text>
              <Text>Pickup Address: {item.pickup_address}</Text>
              <Text>Weight: {item.weight}</Text>
              <Text>Number of Pieces: {item.number_of_pieces}</Text>
            </TouchableOpacity>
          )}
        />
      )}
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
});

export default DeliveryHistory;
