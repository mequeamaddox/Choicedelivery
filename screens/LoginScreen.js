import React, { useState } from 'react';
import { Alert, TouchableOpacity, Text, View, Image } from 'react-native';
import styled from 'styled-components/native';
import { auth } from '../src/firebaseConfig';
import { signInWithEmailAndPassword } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { verifyFirebaseToken } from '../services/apiService';

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      console.log('User logged in');

      // Get Firebase ID token
      const user = auth.currentUser;
      const idToken = await user.getIdToken();
      console.log('Firebase ID Token:', idToken);

      try {
        const response = await verifyFirebaseToken(idToken);

        if (response.success) {
          console.log('User verified with WordPress:', response);

          // Check if the welcome screen has been shown
          const welcomeShown = await AsyncStorage.getItem('welcomeShown');
          console.log('Welcome shown status:', welcomeShown);
          if (welcomeShown === 'true') {
            // Navigate to the home screen
            navigation.navigate('Home', { deliveries, pickups });
          } else {
            // Show the welcome screen
            navigation.navigate('Welcome');
          }
        } else {
          console.error('Verification failed:', response.message);
          Alert.alert('Verification failed', 'There was a problem verifying your account. Please try again.');
          return;
        }
      } catch (error) {
        console.error('Error verifying token with WordPress:', error);
        Alert.alert('Verification failed', 'There was a problem verifying your account. Please try again.');
        return;
      }
    } catch (error) {
      console.error('Login failed', error);
      Alert.alert('Login failed', error.message);
    }
  };

  return (
    <Container>
      <LogoContainer>
        <Logo source={require('../assets/cd-logo.png')} resizeMode="contain" />
      </LogoContainer>
      <Title>Login</Title>
      <Input
        placeholder="Email"
        placeholderTextColor="#888"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
      />
      <Input
        placeholder="Password"
        placeholderTextColor="#888"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <ButtonContainer>
        <StyledButton onPress={handleLogin}>
          <ButtonText>Login</ButtonText>
        </StyledButton>
      </ButtonContainer>
    </Container>
  );
};

const Container = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  background-color: #000;
  padding: 16px;
`;

const LogoContainer = styled.View`
  width: 100%;
  align-items: center;
  margin-bottom: 32px;
`;

const Logo = styled.Image`
  width: 150px;
  height: 150px;
`;

const Title = styled.Text`
  font-size: 24px;
  font-weight: bold;
  margin-bottom: 16px;
  color: #fff;
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

export default LoginScreen;
