// src/screens/ConnectivityCheck.js
import React, { useState, useEffect } from 'react';
import { View, Text, Button, Alert } from 'react-native';
import { checkServer as pingServer } from '../services/apiService';

const ConnectivityCheck = () => {
  const [serverStatus, setServerStatus] = useState('');

  const checkServer = async () => {
    try {
      await pingServer();
      setServerStatus('Server is reachable');
    } catch (error) {
      setServerStatus('Network Error: ' + error.message);
    }
  };

  useEffect(() => {
    checkServer();
  }, []);

  return (
    <View>
      <Text>Server Status: {serverStatus}</Text>
      <Button title="Check Again" onPress={checkServer} />
    </View>
  );
};

export default ConnectivityCheck;
