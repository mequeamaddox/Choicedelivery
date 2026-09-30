// "Apply to drive": creates a driver account waiting for review, then signs them in to finish their profile.
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { useVehicleTypes } from '../lib/vehicles';
import { colors } from '../lib/theme';
import { Button, Card, ErrorBox, Field, H2, Muted } from '../components/ui';
import Choice from '../components/Choice';

export default function Apply() {
  const { signUp } = useAuth();
  const types = useVehicleTypes();
  const [v, setV] = useState({ name: '', email: '', phoneNumber: '', password: '', city: '', zip: '',
    type: 'Car', make: '', model: '', year: '', color: '', plate: '' });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (value) => setV({ ...v, [k]: value });
  const submit = async () => {
    const empty = [['name', 'your name'], ['phoneNumber', 'your phone'], ['email', 'your email'], ['password', 'a password'],
      ['make', 'the vehicle make'], ['model', 'the vehicle model'], ['plate', 'the license plate']].find(([k]) => !v[k].trim());
    if (empty) { setError(new Error(`Please enter ${empty[1]}.`)); return; }
    if (v.password.length < 8) { setError(new Error('Your password needs at least 8 characters.')); return; }
    setBusy(true); setError(null);
    try {
      await signUp({
        name: v.name.trim(), email: v.email.trim(), phoneNumber: v.phoneNumber.trim(), password: v.password, city: v.city, zip: v.zip,
        agreed, vehicle: { type: v.type, make: v.make, model: v.model, year: v.year, color: v.color, plate: v.plate },
      });
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Muted>Deliver in and around Columbia on your schedule. Apply in 2 minutes; we'll review it and email you.</Muted>
        <ErrorBox error={error} />
        <Card>
          <H2>About you</H2>
          <Field label="Full name" value={v.name} onChangeText={set('name')} autoComplete="name" />
          <Field label="Mobile phone" value={v.phoneNumber} onChangeText={set('phoneNumber')} keyboardType="phone-pad" autoComplete="tel" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 2 }}><Field label="City" value={v.city} onChangeText={set('city')} /></View>
            <View style={{ flex: 1 }}><Field label="ZIP" value={v.zip} onChangeText={set('zip')} keyboardType="number-pad" maxLength={10} /></View>
          </View>
          <Field label="Email" value={v.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <Field label="Password" value={v.password} onChangeText={set('password')} secureTextEntry autoComplete="new-password"
            hint="At least 8 characters." />
        </Card>
        <Card>
          <H2>Your vehicle</H2>
          <Choice options={types} value={v.type} onChange={set('type')} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="Make" value={v.make} onChangeText={set('make')} placeholder="Honda" /></View>
            <View style={{ flex: 1 }}><Field label="Model" value={v.model} onChangeText={set('model')} placeholder="Civic" /></View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="Year" value={v.year} onChangeText={set('year')} keyboardType="number-pad" maxLength={4} /></View>
            <View style={{ flex: 1 }}><Field label="Color" value={v.color} onChangeText={set('color')} /></View>
          </View>
          <Field label="License plate" value={v.plate} onChangeText={set('plate')} autoCapitalize="characters" maxLength={12} />
        </Card>
        <Pressable onPress={() => setAgreed(!agreed)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}
          style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.teal, marginTop: 2,
            backgroundColor: agreed ? colors.teal : '#fff', alignItems: 'center', justifyContent: 'center' }}>
            {agreed ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}
          </View>
          <Text style={{ flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 }}>
            I'm 21 or older with a valid driver's license and auto insurance, I agree to work as an independent contractor,
            and I consent to a background and driving-record check.
          </Text>
        </Pressable>
        <Button title="Apply to drive" big onPress={submit} loading={busy} disabled={!agreed} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
