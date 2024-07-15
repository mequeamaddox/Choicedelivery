// src/screens/AppPreferencesScreen.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const AppPreferencesScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>App Preferences</Text>
      {/* Add preference settings here */}
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
});

export default AppPreferencesScreen;
