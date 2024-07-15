// screens/PickUpDetail.js
import React, { useEffect, useState, useRef } from 'react';
import { View, Text, Button, StyleSheet, Alert } from 'react-native';
import { doc, getDoc, updateDoc, addDoc, collection } from 'firebase/firestore';
import { firestore, auth } from '../src/firebaseConfig';
import MapView, { Marker } from 'react-native-maps';
import Signature from 'react-native-signature-canvas';
import * as Linking from 'expo-linking';

const PickUpDetail = ({ route, navigation }) => {
  const { pickupId } = route.params;
  const [pickup, setPickup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSignatureCaptured, setIsSignatureCaptured] = useState(false);
  const signatureRef = useRef(null);

  useEffect(() => {
    const fetchPickup = async () => {
      const docRef = doc(firestore, 'pickups', pickupId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        setPickup({ id: docSnap.id, ...docSnap.data() });
        setLoading(false);
      } else {
        Alert.alert('Error', 'Pickup not found');
        navigation.goBack();
      }
    };

    fetchPickup();
  }, [pickupId, navigation]);

  const handlePickup = async () => {
    const docRef = doc(firestore, 'pickups', pickupId);
    await updateDoc(docRef, { status: 'Picked Up', assignedDriverId: auth.currentUser.uid });
    Alert.alert('Success', 'Pickup marked as picked up');
    setPickup(prevState => ({ ...prevState, status: 'Picked Up' }));
  };

  const handleInTransit = async () => {
    const docRef = doc(firestore, 'pickups', pickupId);
    await updateDoc(docRef, { status: 'In Transit' });
    Alert.alert('Success', 'Pickup marked as in transit');
    setPickup(prevState => ({ ...prevState, status: 'In Transit' }));
  };

  const handleComplete = async (signatureUri) => {
    const docRef = doc(firestore, 'pickups', pickupId);
    const completedDelivery = { ...pickup, status: 'Completed', signature: signatureUri };

    await addDoc(collection(firestore, 'deliveries'), completedDelivery);
    await updateDoc(docRef, { status: 'Completed', signature: signatureUri });
    Alert.alert('Success', 'Pickup marked as completed and added to deliveries');
    navigation.goBack();
  };

  const handleNavigateToAddress = (location) => {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${location.latitude},${location.longitude}`;
    Linking.openURL(url);
  };

  const saveSignature = async (signature) => {
    const signatureUri = `data:image/png;base64,${signature}`;
    setIsSignatureCaptured(true);
    await handleComplete(signatureUri);
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
      <Text style={styles.title}>{pickup.customerName}</Text>
      <Text style={styles.detail}>Pickup Address: {pickup.pickupAddress}</Text>
      <Text style={styles.detail}>Delivery Address: {pickup.deliveryAddress}</Text>
      <Text style={styles.detail}>Status: {pickup.status}</Text>
      <MapView
        style={styles.map}
        initialRegion={{
          latitude: pickup.pickupLocation.latitude,
          longitude: pickup.pickupLocation.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }}
      >
        <Marker coordinate={pickup.pickupLocation} title="Pickup Location" />
        <Marker coordinate={pickup.deliveryLocation} title="Delivery Location" />
      </MapView>
      {pickup.status === 'Pending' && (
        <Button title="Mark as Picked Up" onPress={handlePickup} />
      )}
      {pickup.status === 'Picked Up' && (
        <>
          <Button title="Mark as In Transit" onPress={handleInTransit} />
          <Button title="Navigate to Delivery Address" onPress={() => handleNavigateToAddress(pickup.deliveryLocation)} />
        </>
      )}
      {pickup.status === 'In Transit' && (
        <>
          <Signature
            ref={signatureRef}
            onOK={saveSignature}
            descriptionText="Sign to Complete Pickup"
            clearText="Clear"
            confirmText="Save"
            webStyle={styles.signature}
          />
          <Button title="Complete Pickup" onPress={() => signatureRef.current.readSignature()} />
          <Button title="Navigate to Delivery Address" onPress={() => handleNavigateToAddress(pickup.deliveryLocation)} />
        </>
      )}
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
  map: {
    height: 200,
    marginBottom: 16,
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

export default PickUpDetail;
