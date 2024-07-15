// src/screens/PickUpDetail.js
import React, { useEffect, useState } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import { getDatabase, ref, get, update } from 'firebase/database';
import MapView, { Marker } from 'react-native-maps';
import * as Linking from 'expo-linking';
import styled from 'styled-components/native';
import { Ionicons } from '@expo/vector-icons';

const PickUpDetail = ({ route, navigation }) => {
  const { requestId } = route.params;
  const [pickup, setPickup] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPickup = async () => {
      const db = getDatabase();
      const pickupRef = ref(db, `pickups/${requestId}`);
      const snapshot = await get(pickupRef);

      if (snapshot.exists()) {
        const data = snapshot.val();
        console.log('Fetched Pickup Data:', data); // Debugging statement
        setPickup({ id: snapshot.key, ...data });
        setLoading(false);
      } else {
        Alert.alert('Error', 'Pickup not found');
        navigation.goBack();
      }
    };

    fetchPickup();
  }, [requestId, navigation]);

  const handleNavigateToAddress = (address) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
    Linking.openURL(url);
  };

  const handleConfirmPickup = async () => {
    try {
      const db = getDatabase();
      const pickupRef = ref(db, `pickups/${requestId}`);
      await update(pickupRef, { status: 'picked up' }); // Update pickup status to 'picked up'
      navigation.replace('ConfirmPickup', { requestId });
      console.log('Pickup accepted and navigating to ConfirmPickup'); // Debugging statement
    } catch (error) {
      console.error('Error accepting pickup:', error); // Debugging statement
      Alert.alert('Error', 'Failed to accept pickup');
    }
  };

  if (loading) {
    return (
      <LoadingContainer>
        <Text>Loading...</Text>
      </LoadingContainer>
    );
  }

  const renderMarkers = () => {
    if (!pickup || !pickup.pickup_location || !pickup.delivery_location) {
      return null;
    }

    const { pickup_location, delivery_location } = pickup;
    if (!pickup_location.lat || !pickup_location.lng || !delivery_location.lat || !delivery_location.lng) {
      return null;
    }

    return (
      <>
        <Marker coordinate={{ latitude: pickup_location.lat, longitude: pickup_location.lng }} title="Pickup Location" />
        <Marker coordinate={{ latitude: delivery_location.lat, longitude: delivery_location.lng }} title="Delivery Location" />
      </>
    );
  };

  return (
    <Container>
      <DetailsContainer>
        <Title>{pickup.contact_name}</Title>
        <Detail>Pickup Address: {pickup.pickup_address}</Detail>
        <Detail>Delivery Address: {pickup.destination_address}</Detail>
        <Detail>Number of Pieces: {pickup.number_of_pieces}</Detail>
        <Detail>Weight: {pickup.weight}</Detail>
        <Detail>Requested Vehicle Type: {pickup.vehicle_type}</Detail>
      </DetailsContainer>

      {pickup.pickup_location && pickup.delivery_location ? (
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: pickup.pickup_location.lat,
            longitude: pickup.pickup_location.lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
        >
          {renderMarkers()}
        </MapView>
      ) : (
        <Text style={styles.errorText}>Location data is not available</Text>
      )}

      <ButtonContainer>
        <StyledButton onPress={() => handleNavigateToAddress(pickup.pickup_address)}>
          <Ionicons name="navigate-outline" size={24} color="#fff" />
          <ButtonText>Navigate</ButtonText>
        </StyledButton>
        <StyledButton onPress={handleConfirmPickup}>
          <Ionicons name="checkbox-outline" size={24} color="#fff" />
          <ButtonText>Confirm Pickup</ButtonText>
        </StyledButton>
      </ButtonContainer>
    </Container>
  );
};

const styles = StyleSheet.create({
  map: {
    height: 200,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color: 'red',
    textAlign: 'center',
    marginBottom: 16,
  },
});

const DetailsContainer = styled.View`
  margin-bottom: 16px;
  padding: 16px;
  background-color: #f9f9f9;
  border-radius: 8px;
  box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.1);
`;

const Container = styled.View`
  flex: 1;
  padding: 16px;
  background-color: #f5f5f5;
`;

const LoadingContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  background-color: #f5f5f5;
`;

const Title = styled.Text`
  font-size: 20px;
  font-weight: bold;
  margin-bottom: 16px;
  color: #333;
`;

const Detail = styled.Text`
  font-size: 16px;
  margin-bottom: 8px;
  color: #333;
`;

const ButtonContainer = styled.View`
  flex-direction: row;
  justify-content: space-between;
  margin-top: 20px;
`;

const StyledButton = styled.TouchableOpacity`
  background-color: #6200ee;
  padding: 10px;
  margin: 0 10px;
  border-radius: 5px;
  flex: 1;
  align-items: center;
`;

const ButtonText = styled.Text`
  color: #fff;
  font-size: 16px;
`;

export default PickUpDetail;
