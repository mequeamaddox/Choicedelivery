import React, { useState } from 'react';
import { Alert, TouchableOpacity, Text, View, Image } from 'react-native';
import styled from 'styled-components/native';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const auth = getAuth();

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      console.log('User logged in');

      const user = auth.currentUser;
      const idToken = await user.getIdToken();
      console.log('Firebase ID Token:', idToken);

      // Here you can call your API if needed or navigate to the home screen directly
      const welcomeShown = await AsyncStorage.getItem('welcomeShown');
      if (welcomeShown === 'true') {
        navigation.navigate('Home', { deliveries: [], pickups: [] });
      } else {
        navigation.navigate('Welcome');
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
