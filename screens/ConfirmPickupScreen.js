import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { getDatabase, ref, get, update, serverTimestamp } from 'firebase/database';
import * as ImagePicker from 'expo-image-picker';
import Signature from 'react-native-signature-canvas';
import styled from 'styled-components/native';
import { FontAwesome } from '@expo/vector-icons';

const ConfirmPickupScreen = ({ route, navigation }) => {
  const { requestId } = route.params;
  const [pickup, setPickup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [image, setImage] = useState(null);
  const [signature, setSignature] = useState(null);
  const signatureRef = useRef(null);

  useEffect(() => {
    const fetchPickup = async () => {
      try {
        const db = getDatabase();
        const pickupRef = ref(db, `pickups/${requestId}`);
        const snapshot = await get(pickupRef);

        if (snapshot.exists()) {
          const data = snapshot.val();
          console.log('Fetched Pickup Data:', data); // Debugging statement
          setPickup({ id: snapshot.key, ...data });
        } else {
          Alert.alert('Error', 'Pickup not found');
          navigation.goBack();
        }
      } catch (error) {
        console.error('Error fetching pickup:', error);
        Alert.alert('Error', 'Failed to load pickup details');
        navigation.goBack();
      } finally {
        setLoading(false);
      }
    };

    fetchPickup();
  }, [requestId, navigation]);

  const handlePickImage = async () => {
    let result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1,
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
    }
  };

  const handleSignature = (signature) => {
    setSignature(signature);
  };

  const handleSaveSignature = () => {
    signatureRef.current.readSignature();
    Alert.alert('Success', 'Updated saved.');
  };

  const handleConfirmPickup = async () => {
    try {
      if (signature || image) {
        const db = getDatabase();
        const pickupRef = ref(db, `pickups/${requestId}`);
        const snapshot = await get(pickupRef);

        if (snapshot.exists()) {
          const pickupData = snapshot.val();
          const updatedData = {
            ...pickupData,
            status: 'In Transit',
            signature: signature || '',
            image: image || '',
            confirmedAt: serverTimestamp(),
          };

          // Update the status and add signature/photo in the pickups collection
          await update(pickupRef, updatedData);

          navigation.replace('DeliveryOverview', { requestId }); // Navigate to DeliveryScreen after confirming pickup
        } else {
          Alert.alert('Error', 'Pickup not found');
        }
      } else {
        Alert.alert('Error', 'Please provide a signature or a photo');
      }
    } catch (error) {
      console.error('Error confirming pickup:', error);
      Alert.alert('Error', 'Failed to confirm pickup');
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6200ee" />
        <Text>Loading...</Text>
      </View>
    );
  }

  if (!pickup) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Pickup details could not be loaded.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <DetailsContainer>
        <Title>{pickup.contact_name || 'No Name Available'}</Title>
        <Detail>Pickup Address: {pickup.pickup_address || 'No Address Available'}</Detail>
        <Detail>Delivery Address: {pickup.destination_address || 'No Address Available'}</Detail>
        <Detail>Number of Pieces: {pickup.number_of_pieces || 'N/A'}</Detail>
        <Detail>Weight: {pickup.weight || 'N/A'}</Detail>
        <Detail>Requested Vehicle Type: {pickup.vehicle_type || 'N/A'}</Detail>
      </DetailsContainer>

      <ButtonContainer>
        <StyledButton onPress={handlePickImage}>
          <FontAwesome name="camera" size={24} color="white" />
          <ButtonText>Take Picture</ButtonText>
        </StyledButton>
        {image && (
          <Image source={{ uri: image }} style={{ width: 200, height: 200 }} />
        )}
        <StyledButton onPress={handleSaveSignature}>
          <FontAwesome name="pencil" size={24} color="white" />
          <ButtonText>Save Signature</ButtonText>
        </StyledButton>
      </ButtonContainer>
      <SignatureContainer>
        <Signature
          ref={signatureRef}
          onOK={handleSignature}
          descriptionText="Sign to confirm pickup"
          clearText="Clear"
          confirmText="Save"
          webStyle={styles.signature}
          autoClear={false}
        />
      </SignatureContainer>
      <ButtonContainer>
        <StyledButton onPress={handleConfirmPickup}>
          <FontAwesome name="check" size={24} color="white" />
          <ButtonText>Confirm Pickup</ButtonText>
        </StyledButton>
      </ButtonContainer>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  detail: {
    fontSize: 16,
    marginBottom: 8,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signature: `
    .m-signature-pad--footer {
      display: none;
      margin: 0px;
    }
    .m-signature-pad--body {
      border: none;
      box-shadow: none;
    }
  `,
});

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

const SignatureContainer = styled.View`
  margin-top: 20px;
  border: 1px solid #ccc;
  padding: 10px;
  border-radius: 5px;
  background-color: #f5f5f5;
  height: 200px; /* Increased height for better signature capture space */
`;

const DetailsContainer = styled.View`
  margin-bottom: 16px;
  padding: 16px;
  background-color: #f9f9f9;
  border-radius: 8px;
  box-shadow: 0px 2px 4px rgba(0, 0, 0, 0.1);
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

export default ConfirmPickupScreen;
