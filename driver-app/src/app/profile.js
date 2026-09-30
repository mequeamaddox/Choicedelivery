// Driver profile: photo, contact details, vehicle, license, insurance and document photos. Dispatch
// reviews these before approving a driver; expired license/insurance pause work until updated.
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { api, API_URL } from '../lib/client';
import { pickPhoto } from '../lib/photos';
import { useVehicleTypes } from '../lib/vehicles';
import { colors } from '../lib/theme';
import { Button, Card, ErrorBox, Field, H2, Muted, Notice } from '../components/ui';
import Choice from '../components/Choice';

const DOCS = [
  ['license_front', "Driver's license (front)"],
  ['license_back', "Driver's license (back)"],
  ['insurance', 'Insurance card'],
  ['vehicle', 'Photo of your vehicle'],
  ['registration', 'Vehicle registration'],
];
const REQUIRED = new Set(['license_front', 'insurance', 'vehicle']);
const isDate = (s) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s);

// Asks camera vs. photo library, then returns the picked photo (or null).
function choosePhoto(options) {
  return new Promise((resolve, reject) => {
    const run = (source) => pickPhoto({ ...options, source }).then(resolve, reject);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: ['Take photo', 'Choose from library', 'Cancel'], cancelButtonIndex: 2 },
        (i) => (i === 0 ? run('camera') : i === 1 ? run('library') : resolve(null)));
    } else if (Platform.OS === 'web') {
      run('library');
    } else {
      Alert.alert('Add photo', undefined, [
        { text: 'Take photo', onPress: () => run('camera') },
        { text: 'Choose from library', onPress: () => run('library') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ]);
    }
  });
}

function DocTile({ userId, kind, label, uploaded, onUploaded }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (uploaded && !preview) api.document(userId, kind).then((d) => setPreview(d.data)).catch(() => {});
  }, [uploaded]);
  const add = async () => {
    try {
      const data = await choosePhoto({ maxSize: 1600 });
      if (!data) return;
      setBusy(true);
      onUploaded(await api.uploadDocument(kind, data));
      setPreview(data);
    } catch (e) { Alert.alert("Couldn't save the photo", e.message); } finally { setBusy(false); }
  };
  return (
    <Pressable onPress={add} accessibilityRole="button" accessibilityLabel={`${uploaded ? 'Replace' : 'Add'} ${label}`}
      style={{ width: '48%', borderWidth: 1, borderStyle: uploaded ? 'solid' : 'dashed', borderColor: uploaded ? colors.border : colors.teal,
        borderRadius: 12, padding: 8, gap: 6, backgroundColor: '#fff' }}>
      {preview ? <Image source={{ uri: preview }} style={{ height: 90, borderRadius: 8 }} resizeMode="cover" />
        : <View style={{ height: 90, borderRadius: 8, backgroundColor: colors.mintBg, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 28 }}>{busy ? '…' : '📷'}</Text></View>}
      <Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }}>{label}{REQUIRED.has(kind) ? ' *' : ''}</Text>
      <Text style={{ color: uploaded ? colors.green : colors.teal, fontSize: 12, fontWeight: '600' }}>
        {busy ? 'Uploading…' : uploaded ? '✓ Uploaded · tap to replace' : 'Tap to add'}
      </Text>
    </Pressable>
  );
}

export default function Profile() {
  const { user, setUser } = useAuth();
  const types = useVehicleTypes();
  const p = user.driverProfile || {};
  const veh = user.vehicle || {};
  const [v, setV] = useState({
    name: user.name || '', phoneNumber: user.phoneNumber || '', city: p.city || '', zip: p.zip || '',
    ecName: p.emergencyContact?.name || '', ecPhone: p.emergencyContact?.phone || '',
    type: veh.type || user.vehicleType || 'Car', make: veh.make || '', model: veh.model || '', year: veh.year || '',
    color: veh.color || '', plate: veh.plate || '',
    licNumber: p.license?.number || '', licState: p.license?.state || 'SC', licExpires: p.license?.expires || '',
    insCompany: p.insurance?.company || '', insPolicy: p.insurance?.policyNumber || '', insExpires: p.insurance?.expires || '',
  });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const set = (k) => (value) => { setV({ ...v, [k]: value }); setSaved(false); };

  const save = async () => {
    if (!isDate(v.licExpires) || !isDate(v.insExpires)) { setError(new Error('Enter expiration dates as YYYY-MM-DD, e.g. 2027-08-31.')); return; }
    setBusy(true); setError(null);
    try {
      setUser(await api.updateMe({
        name: v.name, phoneNumber: v.phoneNumber,
        vehicle: { type: v.type, make: v.make, model: v.model, year: v.year, color: v.color, plate: v.plate },
        driverProfile: {
          city: v.city, zip: v.zip, emergencyContact: { name: v.ecName, phone: v.ecPhone },
          license: { number: v.licNumber, state: v.licState, expires: v.licExpires },
          insurance: { company: v.insCompany, policyNumber: v.insPolicy, expires: v.insExpires },
        },
      }));
      setSaved(true);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const changePhoto = async () => {
    try {
      const data = await choosePhoto({ maxSize: 600, square: true });
      if (!data) return;
      setPhotoBusy(true);
      setUser(await api.uploadDocument('photo', data));
    } catch (e) { Alert.alert("Couldn't save the photo", e.message); } finally { setPhotoBusy(false); }
  };
  const c = user.checklist || { missing: [], expired: [] };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {c.expired.length ? <Notice tone="red">{c.expired.join('. ')}. Update it below to keep taking jobs.</Notice> : null}
        {c.missing.length ? <Notice>Still needed: {c.missing.join(', ')}.</Notice> : <Notice tone="green">✓ Your profile is complete.</Notice>}

        <Card style={{ alignItems: 'center' }}>
          <Pressable onPress={changePhoto} accessibilityRole="button" accessibilityLabel="Change profile photo">
            {user.photoUrl ? <Image source={{ uri: `${API_URL}${user.photoUrl}` }} style={{ width: 110, height: 110, borderRadius: 55 }} />
              : <View style={{ width: 110, height: 110, borderRadius: 55, backgroundColor: colors.mintBg, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 40, color: colors.tealDark, fontWeight: '800' }}>{(user.name || '?')[0]}</Text></View>}
          </Pressable>
          <Button title={photoBusy ? 'Uploading…' : user.photoUrl ? 'Change photo' : 'Add profile photo'} variant="ghost" onPress={changePhoto} />
          <Muted small style={{ textAlign: 'center' }}>A clear photo of your face. Customers see it when you're on the way.</Muted>
        </Card>

        <ErrorBox error={error} />
        <Card>
          <H2>About you</H2>
          <Field label="Full name" value={v.name} onChangeText={set('name')} autoComplete="name" />
          <Field label="Mobile phone" value={v.phoneNumber} onChangeText={set('phoneNumber')} keyboardType="phone-pad" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 2 }}><Field label="City" value={v.city} onChangeText={set('city')} /></View>
            <View style={{ flex: 1 }}><Field label="ZIP" value={v.zip} onChangeText={set('zip')} keyboardType="number-pad" maxLength={10} /></View>
          </View>
          <Muted small>Emergency contact</Muted>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="Name" value={v.ecName} onChangeText={set('ecName')} /></View>
            <View style={{ flex: 1 }}><Field label="Phone" value={v.ecPhone} onChangeText={set('ecPhone')} keyboardType="phone-pad" /></View>
          </View>
        </Card>

        <Card>
          <H2>Vehicle</H2>
          <Choice options={types} value={v.type} onChange={set('type')} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="Make" value={v.make} onChangeText={set('make')} /></View>
            <View style={{ flex: 1 }}><Field label="Model" value={v.model} onChangeText={set('model')} /></View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Field label="Year" value={v.year} onChangeText={set('year')} keyboardType="number-pad" maxLength={4} /></View>
            <View style={{ flex: 1 }}><Field label="Color" value={v.color} onChangeText={set('color')} /></View>
          </View>
          <Field label="License plate" value={v.plate} onChangeText={set('plate')} autoCapitalize="characters" maxLength={12} />
        </Card>

        <Card>
          <H2>Driver's license</H2>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 3 }}><Field label="License number" value={v.licNumber} onChangeText={set('licNumber')} autoCapitalize="characters" /></View>
            <View style={{ flex: 1 }}><Field label="State" value={v.licState} onChangeText={set('licState')} autoCapitalize="characters" maxLength={2} /></View>
          </View>
          <Field label="Expires" value={v.licExpires} onChangeText={set('licExpires')} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
        </Card>

        <Card>
          <H2>Auto insurance</H2>
          <Field label="Insurance company" value={v.insCompany} onChangeText={set('insCompany')} />
          <Field label="Policy number" value={v.insPolicy} onChangeText={set('insPolicy')} autoCapitalize="characters" />
          <Field label="Expires" value={v.insExpires} onChangeText={set('insExpires')} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" maxLength={10} />
        </Card>

        {saved ? <Notice tone="green">Saved.</Notice> : null}
        <Button title="Save profile" big onPress={save} loading={busy} />

        <Card>
          <H2>Document photos</H2>
          <Muted small>Clear, readable photos. Only Choice Delivery staff can see these. * = required</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>
            {DOCS.map(([kind, label]) => (
              <DocTile key={kind} userId={user.id} kind={kind} label={label} uploaded={(user.documents || []).includes(kind)} onUploaded={setUser} />
            ))}
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
