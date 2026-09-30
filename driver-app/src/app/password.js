import { useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../lib/client';
import { Button, ErrorBox, Field, Notice } from '../components/ui';

export default function ChangePassword() {
  const router = useRouter();
  const [v, setV] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (v.next !== v.confirm) { setError(new Error("The new passwords don't match.")); return; }
    setBusy(true); setError(null);
    try { await api.changePassword(v.current, v.next); setDone(true); setTimeout(() => router.back(), 1200); }
    catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <ErrorBox error={error} />
      {done ? <Notice tone="green">Password changed.</Notice> : null}
      <Field label="Current password" value={v.current} onChangeText={(current) => setV({ ...v, current })} secureTextEntry autoComplete="current-password" />
      <Field label="New password" value={v.next} onChangeText={(next) => setV({ ...v, next })} secureTextEntry autoComplete="new-password" hint="At least 8 characters." />
      <Field label="Confirm new password" value={v.confirm} onChangeText={(confirm) => setV({ ...v, confirm })} secureTextEntry autoComplete="new-password" />
      <Button title="Change password" onPress={submit} loading={busy} disabled={!v.current || v.next.length < 8} />
    </ScrollView>
  );
}
