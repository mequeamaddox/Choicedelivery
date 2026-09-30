import { useState } from 'react';
import { ScrollView } from 'react-native';
import { api } from '../lib/client';
import { Button, ErrorBox, Field, Muted, Notice } from '../components/ui';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try { setDone((await api.forgotPassword(email.trim())).message); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Muted>Enter your email and we'll send you a link to choose a new password.</Muted>
      <ErrorBox error={error} />
      {done ? <Notice tone="green">{done}</Notice> : null}
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Button title="Send reset link" onPress={submit} loading={busy} disabled={!email.trim()} />
    </ScrollView>
  );
}
