// src/screens/DeliveryScreen.js
import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity, Image, TextInput, ActivityIndicator } from 'react-native';
import { getDatabase, ref, get, update } from 'firebase/database';
import * as ImagePicker from 'expo-image-picker';
import Signature from 'react-native-signature-canvas';
import styled from 'styled-components/native';
import { FontAwesome } from '@expo/vector-icons';

const DeliveryScreen = ({ route, navigation }) => {
  const { deliveryId } = route.params; // Use deliveryId to fetch data
  const [delivery, setDelivery] = useState(null);
  const [loading, setLoading] = useState(true);
  const [image, setImage] = useState(null);
  const [signature, setSignature] = useState(null);
  const [printedName, setPrintedName] = useState('');
  const signatureRef = useRef(null);

  useEffect(() => {
    const fetchDelivery = async () => {
      try {
        const db = getDatabase();
        const deliveryRef = ref(db, `pickups/${deliveryId}`);
        const snapshot = await get(deliveryRef);

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
  }, [deliveryId, navigation]);

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
    Alert.alert('Success', 'Saved');
  };

  const handleCompleteDelivery = async () => {
    if (!signature && !image) {
      Alert.alert('Error', 'Please provide a signature or a photo');
      return;
    }

    if (!printedName) {
      Alert.alert('Error', 'Please enter the printed name');
      return;
    }

    try {
      const db = getDatabase();
      const pickupRef = ref(db, `pickups/${deliveryId}`);
      await update(pickupRef, {
        status: 'Completed',
        deliveryTimestamp: new Date().toISOString(),
        signature: signature || '',
        image: image || '',
        printedName,
      });

      Alert.alert('Success', 'Delivery marked as completed');
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      }); // Navigate back to the home page and reset the stack
    } catch (error) {
      console.error('Error completing delivery:', error);
      Alert.alert('Error', 'Failed to complete delivery');
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

  if (!delivery) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Delivery details could not be loaded.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <DetailsContainer>
        <Title>Delivery Details:</Title>
        <Detail>Contact Name: {delivery.contact_name || 'N/A'}</Detail>
        <Detail>Delivery Address: {delivery.destination_address || 'N/A'}</Detail>
        <Detail>Weight: {delivery.weight || 'N/A'}</Detail>
        <Detail>Number of Pieces: {delivery.number_of_pieces || 'N/A'}</Detail>
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
          descriptionText="Sign to confirm delivery"
          clearText="Clear"
          confirmText="Save"
          webStyle={styles.signature}
          autoClear={false}
        />
      </SignatureContainer>
      <TextInput
        style={styles.input}
        placeholder="Enter Printed Name"
        value={printedName}
        onChangeText={setPrintedName}
      />
      <ButtonContainer>
        <StyledButton onPress={handleCompleteDelivery} style={styles.completeButton}>
          <FontAwesome name="check" size={24} color="white" />
          <ButtonText>Complete Delivery</ButtonText>
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
  input: {
    width: '100%',
    padding: 10,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  completeButton: {
    marginTop: 20,
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
  color: #666;
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
  flex-direction: row;
  justify-content: center;
`;

const ButtonText = styled.Text`
  color: #fff;
  font-size: 16px;
  margin-left: 8px;
`;

const SignatureContainer = styled.View`
  margin-top: 20px;
  border: 1px solid #ccc;
  padding: 10px;
  border-radius: 5px;
  background-color: #f5f5f5;
  height: 200px; /* Increased height for better signature capture space */
`;

export default DeliveryScreen;
