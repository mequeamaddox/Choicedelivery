import { Alert, Image, Linking, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useAuth } from '../../lib/auth';
import { API_URL } from '../../lib/client';
import { colors } from '../../lib/theme';
import { Badge, Button, Card, H2, Muted, Notice, Row } from '../../components/ui';
import LegalLinks from '../../components/LegalLinks';

const STATUS = { applied: ['Application in review', 'amber'], approved: ['Approved driver', 'green'],
  rejected: ['Not approved', 'gray'], suspended: ['On hold', 'red'] };

export default function Account() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const c = user?.checklist || { missing: [], expired: [] };
  const [label, tone] = STATUS[user?.driverStatus] || ['Driver', 'gray'];
  const v = user?.vehicle || {};
  const confirmSignOut = () => Alert.alert('Sign out?', "You'll go offline and stop getting job alerts.", [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => signOut() },
  ]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          {user?.photoUrl ? <Image source={{ uri: `${API_URL}${user.photoUrl}` }} style={{ width: 64, height: 64, borderRadius: 32 }} />
            : <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.mintBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 26, fontWeight: '800', color: colors.tealDark }}>{(user?.name || '?')[0]}</Text></View>}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontSize: 19, fontWeight: '800', color: colors.text }}>{user?.name || 'Driver'}</Text>
            <Muted small>{user?.email}</Muted>
            <Badge label={label} tone={tone} />
          </View>
        </View>
        <Row label="Phone" value={user?.phoneNumber || '—'} />
        <Row label="Vehicle" value={[v.color, v.make, v.model].filter(Boolean).join(' ') || v.type || '—'} />
        <Row label="Plate" value={v.plate || '—'} />
        {c.expired.length ? <Notice tone="red">{c.expired.join('. ')}.</Notice> : null}
        {c.missing.length ? <Notice>Profile incomplete: {c.missing.length} item{c.missing.length === 1 ? '' : 's'} left.</Notice> : null}
        <Button title="Edit profile & documents" onPress={() => router.push('/profile')} />
      </Card>
      <Card>
        <H2>Location & alerts</H2>
        <Muted small>For live tracking with the screen off, Location should be "Allow all the time" and notifications on.</Muted>
        <Button title="Open phone settings" variant="secondary" onPress={() => Linking.openSettings()} />
      </Card>
      <Card>
        <H2>Account</H2>
        <Button title="Change password" variant="secondary" onPress={() => router.push('/password')} />
        <Button title="Call dispatch (803) 949-7034" variant="secondary" onPress={() => Linking.openURL('tel:8039497034')} />
        <Muted small>Version {Constants.expoConfig?.version} · {API_URL.replace('https://', '')}</Muted>
      </Card>
      <Button title="Sign out" variant="danger" onPress={confirmSignOut} />
      <LegalLinks />
    </ScrollView>
  );
}
