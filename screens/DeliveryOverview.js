// src/screens/DeliveryOverview.js
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Linking, Alert, ActivityIndicator } from 'react-native';
import { getDatabase, ref, get, update } from 'firebase/database';
import MapView, { Marker } from 'react-native-maps';
import styled from 'styled-components/native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

const DeliveryOverview = ({ route, navigation }) => {
  const { requestId } = route.params;
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentLocation, setCurrentLocation] = useState(null);

  useEffect(() => {
    const fetchDelivery = async () => {
      try {
        console.log('Fetching delivery with ID:', requestId);
        const db = getDatabase();
        const pickupRef = ref(db, `pickups/${requestId}`);
        const snapshot = await get(pickupRef);

        if (snapshot.exists()) {
          const data = snapshot.val();
          console.log('Fetched Pickup Data:', data); // Debugging statement
          setDelivery({ id: snapshot.key, ...data });
          setLoading(false);
        } else {
          console.log('Delivery not found');
          Alert.alert('Error', 'Delivery not found');
          navigation.goBack();
        }
      } catch (error) {
        console.error('Error fetching delivery:', error);
        Alert.alert('Error', 'Failed to load delivery details');
        navigation.goBack();
      }
    };

    fetchDelivery();
  }, [requestId, navigation]);

  const handleNavigateToAddress = async (address) => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Permission to access location was denied');
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      setCurrentLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
      Linking.openURL(url);
    } catch (error) {
      console.error('Error getting current location:', error);
    }
  };

  const handleCallRecipient = (phoneNumber) => {
    const url = `tel:${phoneNumber}`;
    Linking.openURL(url);
  };

  const handleMessageRecipient = (phoneNumber) => {
    const url = `sms:${phoneNumber}`;
    Linking.openURL(url);
  };

  const handleConfirmDelivery = async () => {
    try {
      const db = getDatabase();
      const pickupRef = ref(db, `pickups/${delivery.id}`);
      await update(pickupRef, { ...delivery, status: 'Delivered' });
      navigation.replace('DeliveryScreen', { deliveryId: delivery.id });
    } catch (error) {
      console.error('Error confirming delivery:', error);
      Alert.alert('Error', 'Failed to confirm delivery');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6200ee" />
      </View>
    );
  }

  if (!delivery) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Delivery details could not be loaded.</Text>
      </View>
    );
  }

  return (
    <Container>
      <DetailsContainer>
        <Title>Delivery Overview</Title>
        <Detail>Recipient Name: {delivery.contact_name || 'N/A'}</Detail>
        <Detail>Delivery Address: {delivery.destination_address || 'N/A'}</Detail>
        <Detail>Weight: {delivery.weight || 'N/A'}</Detail>
        <Detail>Number of Pieces: {delivery.number_of_pieces || 'N/A'}</Detail>
      </DetailsContainer>

      {delivery.delivery_location && (
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: delivery.delivery_location.lat,
            longitude: delivery.delivery_location.lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
        >
          <Marker
            coordinate={{
              latitude: delivery.delivery_location.lat,
              longitude: delivery.delivery_location.lng,
            }}
            title="Delivery Location"
          />
          {currentLocation && (
            <Marker
              coordinate={currentLocation}
              title="Your Location"
              pinColor="blue"
            />
          )}
        </MapView>
      )}

      <ButtonContainer>
        <StyledButton onPress={() => handleNavigateToAddress(delivery.destination_address)}>
          <Ionicons name="navigate-outline" size={24} color="#fff" />
          <ButtonText>Navigate</ButtonText>
        </StyledButton>
        <StyledButton onPress={() => handleCallRecipient(delivery.contact_phone)}>
          <Ionicons name="call-outline" size={24} color="#fff" />
          <ButtonText>Contact</ButtonText>
        </StyledButton>
        <StyledButton onPress={() => handleMessageRecipient(delivery.contact_phone)}>
          <Ionicons name="chatbubble-outline" size={24} color="#fff" />
          <ButtonText>Text</ButtonText>
        </StyledButton>
        <StyledButton onPress={handleConfirmDelivery}>
          <Ionicons name="checkbox-outline" size={24} color="#fff" />
          <ButtonText>Confirm Delivery</ButtonText>
        </StyledButton>
      </ButtonContainer>
    </Container>
  );
};

const Container = styled.View`
  flex: 1;
  padding: 16px;
  background-color: #fff;
`;

const Title = styled.Text`
  font-size: 24px;
  font-weight: bold;
  margin-bottom: 16px;
`;

const Detail = styled.Text`
  font-size: 16px;
  margin-bottom: 8px;
`;

const ButtonContainer = styled.View`
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
  margin-top: 20px;
`;

const StyledButton = styled.TouchableOpacity`
  background-color: #6200ee;
  padding: 10px;
  margin: 5px;
  border-radius: 5px;
  flex: 1;
  align-items: center;
`;

const ButtonText = styled.Text`
  color: #fff;
  font-size: 16px;
`;

const DetailsContainer = styled.View`
  margin-bottom: 16px;
  padding: 16px;
  background-color: #f9f9f9;
  border-radius: 8px;
  box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.1);
`;

const styles = StyleSheet.create({
  map: {
    height: 200,
    marginBottom: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default DeliveryOverview;
