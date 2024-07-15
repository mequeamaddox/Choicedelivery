// src/screens/NotificationSettingsScreen.js
import React, { useState, useEffect } from 'react';
import { View, Text, Switch, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';



const NotificationSettingsScreen = () => {
    const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  
    useEffect(() => {
      const fetchSettings = async () => {
        try {
          const savedSetting = await AsyncStorage.getItem('notificationsEnabled');
          if (savedSetting !== null) {
            setNotificationsEnabled(JSON.parse(savedSetting));
          }
        } catch (error) {
          console.error('Failed to load notification settings:', error);
        }
      };
  
      fetchSettings();
    }, []);
  
    const toggleNotifications = async () => {
      try {
        const newSetting = !notificationsEnabled;
        setNotificationsEnabled(newSetting);
        await AsyncStorage.setItem('notificationsEnabled', JSON.stringify(newSetting));
        Alert.alert('Success', `Notifications ${newSetting ? 'enabled' : 'disabled'}`);
      } catch (error) {
        console.error('Failed to update notification settings:', error);
      }
    };
  
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Notification Settings</Text>
        <View style={styles.setting}>
          <Text style={styles.settingText}>Enable Notifications</Text>
          <Switch
            value={notificationsEnabled}
            onValueChange={toggleNotifications}
          />
        </View>
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
    setting: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '80%',
      marginBottom: 20,
    },
    settingText: {
      fontSize: 18,
    },
  });
  
  export default NotificationSettingsScreen;