import React, { useState, useEffect } from 'react';
import { FlatList, ActivityIndicator } from 'react-native';
import { listenToAssignedDeliveries } from '../../services/deliveryService';
import { auth } from '../firebaseConfig';
import styled from 'styled-components/native';

export default function DriverDeliveriesComponent({ navigation }) {
    const [deliveries, setDeliveries] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const driverId = auth.currentUser.uid;
        const unsubscribe = listenToAssignedDeliveries(driverId, deliveries => {
            setDeliveries(deliveries);
            setLoading(false);
        });

        return () => unsubscribe(); // Cleanup subscription on unmount
    }, []);

    if (loading) {
        return <ActivityIndicator size="large" color="#0000ff" />;
    }

    return (
        <Container>
            <Title>Assigned Deliveries:</Title>
            <FlatList
                data={deliveries}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                    <DeliveryItem onPress={() => navigation.navigate('DriverNote', { deliveryId: item.id })}>
                        <DeliveryContent>
                            <CustomerName>{item.customerName}</CustomerName>
                            <DeliveryDetails>{item.pickupAddress} -> {item.deliveryAddress}</DeliveryDetails>
                        </DeliveryContent>
                        <Chevron>></Chevron>
                    </DeliveryItem>
                )}
            />
        </Container>
    );
}

const Container = styled.View`
    flex: 1;
    padding: 16px;
    background-color: #fff;
`;

const Title = styled.Text`
    font-size: 24px;
    font-weight: bold;
    margin-bottom: 16px;
`;

const DeliveryItem = styled.TouchableOpacity`
    flex-direction: row;
    align-items: center;
    padding: 16px;
    border-bottom-width: 1px;
    border-bottom-color: #ccc;
`;

const DeliveryContent = styled.View`
    flex: 1;
`;

const CustomerName = styled.Text`
    font-size: 18px;
    font-weight: bold;
`;

const DeliveryDetails = styled.Text`
    font-size: 14px;
    color: #555;
`;

const Chevron = styled.Text`
    font-size: 18px;
    color: #555;
`;
