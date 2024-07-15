// src/components/DriverNoteComponent.js
import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';
import { addNoteToDelivery } from '../services/deliveryService';

export default function DriverNoteComponent({ route, navigation }) {
    const { deliveryId } = route.params;
    const [note, setNote] = useState('');

    const handleAddNote = async () => {
        try {
            await addNoteToDelivery(deliveryId, note);
            navigation.goBack();
        } catch (error) {
            console.error('Error adding note: ', error);
        }
    };

    return (
        <View>
            <Text>Delivery ID: {deliveryId}</Text>
            <Text>Note:</Text>
            <TextInput value={note} onChangeText={setNote} />
            <Button title="Add Note" onPress={handleAddNote} />
        </View>
    );
}
