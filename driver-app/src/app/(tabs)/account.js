import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '../../lib/auth';
import { api, API_URL } from '../../lib/client';
import { colors } from '../../lib/theme';
import { Button, Card, ErrorBox, Field, H2, Muted, Notice, Row } from '../../components/ui';

const VEHICLES = ['Car', 'Minivan', 'Pickup Truck'];

export default function Account() {
  const { user, signOut, setUser } = useAuth();
  const [v, setV] = useState({ name: user?.name || '', phoneNumber: user?.phoneNumber || '', vehicleType: user?.vehicleType || '' });
  const [vehicles, setVehicles] = useState(VEHICLES);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.pricing().then((p) => p.vehicleTypes?.length && setVehicles(p.vehicleTypes)).catch(() => {}); }, []);
  const save = async () => {
    setBusy(true); setError(null); setMsg(null);
    try { setUser({ ...(await api.updateMe(v)) }); setMsg('Saved.'); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const confirmSignOut = () => Alert.alert('Sign out?', "You'll go offline and stop getting job alerts.", [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
  ]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Card>
        <H2>Profile</H2>
        <Row label="Email" value={user?.email} />
        <ErrorBox error={error} />
        {msg ? <Notice tone="green">{msg}</Notice> : null}
        <Field label="Name" value={v.name} onChangeText={(name) => setV({ ...v, name })} autoComplete="name" />
        <Field label="Phone" value={v.phoneNumber} onChangeText={(phoneNumber) => setV({ ...v, phoneNumber })}
          keyboardType="phone-pad" autoComplete="tel" hint="Customers and dispatch can call you on this number during a delivery." />
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text }}>Your vehicle</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {vehicles.map((t) => {
            const on = v.vehicleType === t;
            return (
              <Pressable key={t} onPress={() => setV({ ...v, vehicleType: t })} accessibilityRole="radio" accessibilityState={{ selected: on }}
                style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1,
                  borderColor: on ? colors.teal : colors.border, backgroundColor: on ? colors.mintBg : '#fff' }}>
                <Text style={{ color: on ? colors.tealDark : colors.text, fontWeight: '600' }}>{t}</Text>
              </Pressable>
            );
          })}
        </View>
        <Button title="Save" onPress={save} loading={busy} />
      </Card>
      <Card>
        <H2>Location & alerts</H2>
        <Muted small>For live tracking with the screen off, Location should be "Allow all the time" and notifications on.</Muted>
        <Button title="Open phone settings" variant="secondary" onPress={() => Linking.openSettings()} />
      </Card>
      <Card>
        <H2>Help</H2>
        <Button title="Call dispatch (803) 949-7034" variant="secondary" onPress={() => Linking.openURL('tel:8039497034')} />
        <Muted small>Version {Constants.expoConfig?.version} · {API_URL.replace('https://', '')}</Muted>
      </Card>
      <Button title="Sign out" variant="danger" onPress={confirmSignOut} />
    </ScrollView>
  );
}
