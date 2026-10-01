import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Link } from 'expo-router';
import LegalLinks from '../components/LegalLinks';
import { useAuth } from '../lib/auth';
import { colors } from '../lib/theme';
import { Button, ErrorBox, Field, H1, Muted } from '../components/ui';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!email.trim() || !password) { setError(new Error('Enter your email and password.')); return; }
    setBusy(true); setError(null);
    try { await signIn(email, password); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 18 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Image source={require('../../assets/logo.png')} style={{ width: 240, height: 87 }} resizeMode="contain"
            accessibilityLabel="Choice Delivery SC" />
          <H1 style={{ color: colors.teal, fontSize: 22 }}>Driver</H1>
          <Muted style={{ textAlign: 'center' }}>Sign in with the account dispatch set up for you.</Muted>
        </View>
        <ErrorBox error={error} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
          keyboardType="email-address" textContentType="emailAddress" returnKeyType="next" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password"
          textContentType="password" returnKeyType="go" onSubmitEditing={submit} />
        <Button title="Sign in" big onPress={submit} loading={busy} />
        <Link href="/forgot" style={{ color: colors.teal, textAlign: 'center', fontWeight: '600', padding: 8 }}>Forgot password?</Link>
        <View style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: 16, gap: 8 }}>
          <Muted style={{ textAlign: 'center' }}>New to Choice Delivery?</Muted>
          <Link href="/apply" asChild><Button title="Apply to drive" variant="secondary" /></Link>
        </View>
        <LegalLinks />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
