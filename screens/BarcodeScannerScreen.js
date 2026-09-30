// screens/BarcodeScannerScreen.js

import React, { useState, useEffect } from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';
import { Camera } from 'expo-camera';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { markPickedUpByBarcode } from '../services/pickupService';

const BarcodeScannerScreen = ({ route, navigation }) => {
    const { shipmentId } = route.params;
    const [hasPermission, setHasPermission] = useState(null);
    const [scanned, setScanned] = useState(false);

    useEffect(() => {
        (async () => {
            const { status } = await BarCodeScanner.requestPermissionsAsync();
            setHasPermission(status === 'granted');
        })();
    }, []);

    const handleBarCodeScanned = ({ type, data }) => {
        setScanned(true);
        alert(`Barcode with type ${type} and data ${data} has been scanned!`);
        // Handle the scanned data, e.g., mark order as picked up
        markPickedUpByBarcode(data)
          .then(() => {
              alert('Order marked as picked up!');
              navigation.goBack();
          })
          .catch(error => {
              alert('Error marking order as picked up');
              console.error(error);
          });
    };

    if (hasPermission === null) {
        return <Text>Requesting for camera permission</Text>;
    }
    if (hasPermission === false) {
        return <Text>No access to camera</Text>;
    }

    return (
        <View style={styles.container}>
            <BarCodeScanner
                onBarCodeScanned={scanned ? undefined : handleBarCodeScanned}
                style={StyleSheet.absoluteFillObject}
            />
            {scanned && <Button title={'Tap to Scan Again'} onPress={() => setScanned(false)} />}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'column',
        justifyContent: 'center',
    },
});

export default BarcodeScannerScreen;
