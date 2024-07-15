// src/screens/ConnectivityCheck.js
import React, { useState, useEffect } from 'react';
import { View, Text, Button, Alert } from 'react-native';

const ConnectivityCheck = () => {
  const [serverStatus, setServerStatus] = useState('');

  const checkServer = async () => {
    try {
      const response = await fetch('https://choicedeliverysc.com/wp-json/firebase/v1/verify');
      if (response.ok) {
        setServerStatus('Server is reachable');
      } else {
        setServerStatus('Server is not reachable');
      }
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
