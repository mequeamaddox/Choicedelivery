import React, { useState, useEffect } from 'react';
import { Alert, TouchableOpacity, Text, View, Image } from 'react-native';
import styled from 'styled-components/native';
import { auth, firestore } from '../src/firebaseConfig';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';

const DriverProfileScreen = () => {
  const [driver, setDriver] = useState(null);
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [profilePictureUrl, setProfilePictureUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const driverId = auth.currentUser.uid;
    const driverRef = doc(firestore, 'drivers', driverId);

    const unsubscribe = onSnapshot(driverRef, (doc) => {
      if (doc.exists()) {
        const driverData = doc.data();
        setDriver(driverData);
        setEmail(driverData.email || '');
        setPhoneNumber(driverData.phoneNumber || '');
        setVehicleType(driverData.vehicleType || '');
        setProfilePictureUrl(driverData.profilePictureUrl || '');
        setLoading(false);
      } else {
        setDoc(driverRef, { email: '', phoneNumber: '', vehicleType: '', profilePictureUrl: '' });
        setDriver({ email: '', phoneNumber: '', vehicleType: '', profilePictureUrl: '' });
        setLoading(false);
      }
    }, (error) => {
      Alert.alert('Error', 'Failed to fetch profile data.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleUpdateProfile = async () => {
    try {
      const driverId = auth.currentUser.uid;
      const driverRef = doc(firestore, 'drivers', driverId);

      await updateDoc(driverRef, {
        email: email,
        phoneNumber: phoneNumber,
        vehicleType: vehicleType,
        profilePictureUrl: profilePictureUrl || '',
      });

      Alert.alert('Profile Updated', 'Your profile has been updated successfully.');
      setIsEditing(false);
    } catch (error) {
      Alert.alert('Profile Update Failed', error.message);
    }
  };

  const handlePickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1,
    });

    if (!result.canceled) {
      const selectedImageUri = result.assets[0].uri;
      setProfilePictureUrl(selectedImageUri);
    }
  };

  if (loading) {
    return <LoadingContainer><Text>Loading...</Text></LoadingContainer>;
  }

  return (
    <Container>
      <Title>Driver Profile</Title>
      {isEditing ? (
        <>
          <Label>Email</Label>
          <Input
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Label>Phone Number</Label>
          <Input
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            keyboardType="phone-pad"
          />
          <Label>Vehicle Type</Label>
          <Input
            value={vehicleType}
            onChangeText={setVehicleType}
          />
          <Label>Profile Picture</Label>
          <ProfilePictureContainer>
            {profilePictureUrl ? (
              <ProfilePicture source={{ uri: profilePictureUrl }} />
            ) : (
              <ProfilePicturePlaceholder>
                <Text>No Image</Text>
              </ProfilePicturePlaceholder>
            )}
            <PickImageButton onPress={handlePickImage}>
              <ButtonText>Pick Image</ButtonText>
            </PickImageButton>
          </ProfilePictureContainer>
          <ButtonContainer>
            <StyledButton onPress={handleUpdateProfile}>
              <ButtonText>Update Profile</ButtonText>
            </StyledButton>
            <StyledButton onPress={() => setIsEditing(false)}>
              <ButtonText>Cancel</ButtonText>
            </StyledButton>
          </ButtonContainer>
        </>
      ) : (
        <>
          {driver.profilePictureUrl ? (
            <ProfilePicture source={{ uri: driver.profilePictureUrl }} />
          ) : (
            <ProfilePicturePlaceholder>
              <Text>No Image</Text>
            </ProfilePicturePlaceholder>
          )}
          <Label>Email</Label>
          <InfoText>{driver.email}</InfoText>
          <Label>Phone Number</Label>
          <InfoText>{driver.phoneNumber}</InfoText>
          <Label>Vehicle Type</Label>
          <InfoText>{driver.vehicleType}</InfoText>
          <ButtonContainer>
            <StyledButton onPress={() => setIsEditing(true)}>
              <ButtonText>Edit Profile</ButtonText>
            </StyledButton>
          </ButtonContainer>
        </>
      )}
    </Container>
  );
};

const Container = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  background-color: #f5f5f5;
  padding: 16px;
`;

const LoadingContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
`;

const Title = styled.Text`
  font-size: 24px;
  font-weight: bold;
  margin-bottom: 16px;
`;

const Label = styled.Text`
  width: 80%;
  font-size: 16px;
  margin-bottom: 8px;
  color: #333;
`;

const InfoText = styled.Text`
  width: 80%;
  font-size: 16px;
  margin-bottom: 20px;
  color: #000;
`;

const Input = styled.TextInput`
  width: 80%;
  padding: 10px;
  margin-bottom: 20px;
  border: 1px solid #ccc;
  border-radius: 5px;
  background-color: #fff;
  color: #000;
`;

const ProfilePictureContainer = styled.View`
  width: 80%;
  align-items: center;
  margin-bottom: 20px;
`;

const ProfilePicture = styled.Image`
  width: 100px;
  height: 100px;
  border-radius: 50px;
  margin-bottom: 10px;
`;

const ProfilePicturePlaceholder = styled.View`
  width: 100px;
  height: 100px;
  border-radius: 50px;
  background-color: #ccc;
  justify-content: center;
  align-items: center;
  margin-bottom: 10px;
`;

const PickImageButton = styled.TouchableOpacity`
  background-color: #6200ee;
  padding: 10px;
  border-radius: 5px;
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

const ButtonText = styled(Text)`
  color: #fff;
  font-size: 16px;
`;

export default DriverProfileScreen;
