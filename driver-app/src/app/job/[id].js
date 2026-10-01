// One job: accept it, then work through the stops in order (navigate, call, arrive, proof, done).
import { useEffect, useState } from 'react';
import { Alert, Image, Linking, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { pickPhoto } from '../../lib/photos';
import { currentLocation } from '../../lib/here';
import { api } from '../../lib/client';
import { useAuth } from '../../lib/auth';
import { formatDate, formatMoney, mapsUrl, minutesSince, nextStop } from '../../lib/api';
import { useLoader } from '../../lib/useLoader';
import { colors } from '../../lib/theme';
import { Badge, Button, Card, ErrorBox, H2, Loading, Muted, Notice, Row, styles } from '../../components/ui';
import SignatureModal from '../../components/SignatureModal';

const ADD_ON_LABELS = { loading_help: 'Loading/unloading help', inside_delivery: 'Inside delivery / stairs' };

// Minutes since the driver arrived at the stop, with the free wait time from the rate card.
function WaitTimer({ stop, freeMinutes }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(id); }, []);
  const waited = minutesSince(stop.arrivedAt);
  const over = freeMinutes != null && waited > freeMinutes;
  return (
    <Notice tone={over ? 'red' : 'blue'}>
      Waiting {waited} min{freeMinutes != null ? ` · first ${freeMinutes} min are free` : ''}.
      {over ? ' Wait time is being billed to the customer; add a note saying why you were held up.' : ''}
    </Notice>
  );
}

function ProofForm({ order, stop, onDone }) {
  const [signature, setSignature] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [name, setName] = useState('');
  const [signing, setSigning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pickup = stop.type === 'pickup';
  const photograph = async () => {
    setError(null);
    try { const p = await pickPhoto(); if (p) setPhoto(p); } catch (e) { setError(e); }
  };
  const submit = async () => {
    if (pickup && !signature && !photo) { setError(new Error('Add a signature or a photo as proof.')); return; }
    if (!pickup && (!signature || !photo)) { setError(new Error('Take a delivery photo and get the receiver\'s signature.')); return; }
    setBusy(true); setError(null);
    try {
      const location = await currentLocation();
      onDone(await api.complete(order.id, stop.id, {
        signature: signature || undefined, photo: photo || undefined, printedName: name.trim() || undefined, location,
      }));
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: 10 }}>
      <H2>{pickup ? 'Confirm pickup' : 'Confirm delivery'}</H2>
      <Muted small>{pickup ? 'Add a signature or a photo.' : 'A delivery photo and the receiver\'s signature are both required.'}</Muted>
      <ErrorBox error={error} />
      <Text style={styles.label}>{pickup ? 'Name of person handing it off' : 'Name of person receiving'}</Text>
      <TextInput value={name} onChangeText={setName} style={styles.input} autoCapitalize="words" placeholder="Printed name"
        placeholderTextColor="#9CA3AF" />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title={signature ? 'Re-sign' : 'Signature'} icon="✍" variant="secondary" onPress={() => setSigning(true)} style={{ flex: 1 }} />
        <Button title={photo ? 'Retake' : 'Photo'} icon="📷" variant="secondary" onPress={photograph} style={{ flex: 1 }} />
      </View>
      {signature ? <Image source={{ uri: signature }} style={{ height: 90, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: colors.border }} resizeMode="contain" accessibilityLabel="Signature" /> : null}
      {photo ? <Image source={{ uri: photo }} style={{ height: 200, borderRadius: 8 }} resizeMode="cover" accessibilityLabel="Proof photo" /> : null}
      <Button title={pickup ? 'Picked up ✓' : 'Delivered ✓'} big onPress={submit} loading={busy} />
      <SignatureModal visible={signing} title={pickup ? 'Pickup signature' : 'Delivery signature'}
        onCancel={() => setSigning(false)} onDone={(sig) => { setSignature(sig); setSigning(false); }} />
    </View>
  );
}

function Notes({ order, onChange }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try { onChange(await api.addNote(order.id, note.trim())); setNote(''); }
    catch (e) { Alert.alert("Couldn't add the note", e.message); } finally { setBusy(false); }
  };
  return (
    <Card>
      <H2>Notes</H2>
      {order.notes.length === 0 ? <Muted small>No notes yet.</Muted> : order.notes.map((n, i) => (
        <View key={i} style={{ gap: 2 }}>
          <Text style={{ color: colors.text, fontSize: 15 }}>{n.note}</Text>
          <Muted small>{n.authorRole || ''} · {formatDate(n.createdAt)}</Muted>
        </View>
      ))}
      <TextInput value={note} onChangeText={setNote} style={styles.input} placeholder="Note for dispatch (e.g. held up at dock)"
        placeholderTextColor="#9CA3AF" multiline />
      <Button title="Add note" variant="secondary" onPress={add} loading={busy} disabled={!note.trim()} />
    </Card>
  );
}

export default function Job() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [freeMinutes, setFreeMinutes] = useState(null);
  const job = useLoader(() => api.job(id), { pollMs: 20000 });
  useEffect(() => { api.pricing().then((p) => setFreeMinutes(p.fees?.waitFreeMinutes ?? null)).catch(() => {}); }, []);
  const act = async (fn) => {
    setBusy(true); setError(null);
    try { job.setData(await fn()); } catch (e) { setError(e); job.reload(); } finally { setBusy(false); }
  };

  const order = job.data;
  if (!order) return job.error ? <View style={{ padding: 16 }}><ErrorBox error={job.error} /></View> : <Loading />;
  const mine = order.driver?.id === user?.id;
  const next = mine ? nextStop(order) : null;
  const shipment = [
    order.numberOfPieces ? `${order.numberOfPieces} piece${order.numberOfPieces === '1' ? '' : 's'}` : null,
    order.weight || null,
    order.maxPieceLbs != null ? `heaviest ${order.maxPieceLbs} lbs` : null,
  ].filter(Boolean).join(' · ');

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={job.refreshing} onRefresh={job.refresh} tintColor={colors.teal} />}>
      <Stack.Screen options={{ title: order.orderNumber }} />
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge status={order.status} />
        {order.serviceLevel === 'rush' ? <Badge label="RUSH · 2 hours or less" tone="red" /> : null}
        {order.scheduledAt ? <Muted small>Pickup {formatDate(order.scheduledAt)}</Muted> : null}
      </View>
      <ErrorBox error={error} />

      <Card>
        {order.driverPayCents != null ? (
          <Row label="Your pay" value={`${formatMoney(order.driverPayCents)}${order.driverPaidAt ? ' · paid' : ''}`} />
        ) : null}
        <Row label="Vehicle" value={order.vehicleType} />
        <Row label="Load" value={shipment} />
        <Row label="Distance" value={order.distanceMiles != null ? `about ${order.distanceMiles} mi` : null} />
        <Row label="Reference" value={order.trackingNumber} />
        {order.description ? <Muted>{order.description}</Muted> : null}
        {order.addOns?.length ? (
          <Notice tone="teal">Customer booked: {order.addOns.map((k) => ADD_ON_LABELS[k] || k).join(', ')}</Notice>
        ) : null}
      </Card>

      {!mine && order.status === 'pending' ? (
        <Button title="Accept job" big loading={busy} onPress={() => act(() => api.accept(order.id))} />
      ) : null}

      {next ? (
        <Card style={{ borderColor: colors.teal, borderWidth: 2 }}>
          <Muted small>
            Next stop · {next.type === 'pickup' ? 'Pickup' : 'Drop-off'} {next.sequence} of {order.stops.length}
          </Muted>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{next.address}</Text>
          {next.contactName ? <Text style={{ fontSize: 16, color: colors.text }}>{next.contactName}</Text> : null}
          {next.instructions ? <Notice tone="blue">“{next.instructions}”</Notice> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Navigate" icon="🧭" variant="secondary" style={{ flex: 1 }} onPress={() => Linking.openURL(mapsUrl(next))} />
            {next.contactPhone ? (
              <Button title="Call" icon="📞" variant="secondary" style={{ flex: 1 }} onPress={() => Linking.openURL(`tel:${next.contactPhone}`)} />
            ) : null}
          </View>
          {next.status === 'pending' ? (
            <Button title="I've arrived" big loading={busy} onPress={() => act(async () => api.arrive(order.id, next.id, await currentLocation()))} />
          ) : <WaitTimer stop={next} freeMinutes={freeMinutes} />}
          {next.type === 'pickup' && next.barcode ? (
            <Notice tone="green">✓ Package barcode {next.barcode} matches this job.</Notice>
          ) : next.type === 'pickup' && order.trackingNumber ? (
            <Button title="Double-check the package barcode (optional)" variant="ghost" onPress={() => router.push('/scan')} />
          ) : null}
          {next.status !== 'pending' ? <ProofForm key={next.id} order={order} stop={next} onDone={job.setData} /> : null}
        </Card>
      ) : null}

      {order.status === 'completed' ? (
        <Card style={{ backgroundColor: colors.greenBg, borderColor: colors.greenBg }}>
          <H2 style={{ color: colors.green }}>Delivered 🎉</H2>
          <Muted>Nice work. Completed {formatDate(order.completedAt)}.</Muted>
          <Button title="Back to jobs" variant="secondary" onPress={() => router.replace('/')} />
        </Card>
      ) : null}
      {order.status === 'cancelled' ? <Notice tone="red">This job was cancelled by dispatch.</Notice> : null}

      <Card>
        <H2>Route</H2>
        {order.stops.map((s, i) => (
          <View key={s.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
            <Text style={{
              width: 28, height: 28, borderRadius: 14, textAlign: 'center', lineHeight: 28, fontWeight: '800', overflow: 'hidden',
              color: '#fff', backgroundColor: s.status === 'completed' ? '#9CA3AF' : s.type === 'pickup' ? colors.teal : colors.blue,
            }}>{s.type === 'pickup' ? 'P' : i + 1}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontWeight: '700', color: colors.text }}>{s.type === 'pickup' ? 'Pickup' : 'Drop-off'}</Text>
              <Text style={{ color: colors.text }}>{s.address}</Text>
              <Muted small>
                {s.status === 'completed' ? `Done ${formatDate(s.completedAt)}${s.printedName ? ` · ${s.printedName}` : ''}`
                  : s.status === 'arrived' ? `Arrived ${formatDate(s.arrivedAt)}` : 'Not started'}
              </Muted>
            </View>
          </View>
        ))}
      </Card>

      {mine ? <Notes order={order} onChange={job.setData} /> : null}
    </ScrollView>
  );
}
