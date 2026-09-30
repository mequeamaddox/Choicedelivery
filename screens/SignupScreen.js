import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet } from 'react-native';
import { registerUser } from '../services/apiService';

const SignupScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleSignup = async () => {
    if (password !== confirmPassword) {
      console.error('Passwords do not match');
      return;
    }
    try {
      // Creates the first (admin) account; afterwards only a signed-in admin can add drivers.
      await registerUser(email, password);
      console.log('User signed up');
      navigation.navigate('Login'); // Navigate to the login screen after signup
    } catch (error) {
      console.error('Signup failed', error);
    }
  };

  return (
    <View style={styles.container}>
      <Text>Email:</Text>
      <TextInput value={email} onChangeText={setEmail} style={styles.input} />
      <Text>Password:</Text>
      <TextInput value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
      <Text>Confirm Password:</Text>
      <TextInput value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry style={styles.input} />
      <Button title="Signup" onPress={handleSignup} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  input: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    marginBottom: 20,
    padding: 10,
  },
});

export default SignupScreen;
