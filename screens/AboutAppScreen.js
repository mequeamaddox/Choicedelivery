// src/screens/AboutAppScreen.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const AboutAppScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>About the App</Text>
      <Text style={styles.text}>
        This is an application for delivery drivers of Choice Delivery LLC. Version 1.0.0.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  title: {
    fontSize: 24,
    marginBottom: 20,
  },
  text: {
    fontSize: 16,
    textAlign: 'center',
  },
});

export default AboutAppScreen;
