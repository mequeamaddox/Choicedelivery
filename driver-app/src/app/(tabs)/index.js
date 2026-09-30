// Jobs: go online/offline, the jobs you're working on, and open jobs you can accept.
import { useState } from 'react';
import { Linking, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/client';
import { startTracking, stopTracking, trackingState } from '../../lib/tracking';
import { useLoader } from '../../lib/useLoader';
import { colors } from '../../lib/theme';
import { Button, Card, ErrorBox, H2, Muted, Notice } from '../../components/ui';
import JobCard from '../../components/JobCard';

function OnlineCard() {
  const { user, setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const tracking = useLoader(trackingState, { pollMs: 30000 });
  const online = !!user?.isOnline;
  const toggle = async (next) => {
    setBusy(true); setError(null);
    try {
      if (next) await startTracking(); else await stopTracking();
      await api.setOnline(next);
      setUser({ ...user, isOnline: next });
      tracking.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const foregroundOnly = online && tracking.data?.running && !tracking.data?.background;
  return (
    <Card style={online ? { borderColor: colors.teal, backgroundColor: colors.mintBg } : null}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: online ? colors.tealDark : colors.text }}>
            {online ? "You're online" : "You're offline"}
          </Text>
          <Muted small>{online ? 'Getting new job alerts and sharing your location.' : 'Go online to get job alerts and share your location.'}</Muted>
        </View>
        <Switch value={online} onValueChange={toggle} disabled={busy} accessibilityLabel="Online"
          trackColor={{ true: colors.teal, false: colors.border }} thumbColor="#fff" />
      </View>
      <ErrorBox error={error} />
      {foregroundOnly ? (
        <Notice>
          Location only updates while this app is open. To keep customers' tracking live with the screen off,
          set Location to "Allow all the time" for Choice Delivery.
        </Notice>
      ) : null}
      {foregroundOnly ? <Button title="Open settings" variant="secondary" onPress={() => Linking.openSettings()} /> : null}
    </Card>
  );
}

export default function Jobs() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [accepting, setAccepting] = useState(null);
  const jobs = useLoader(async () => {
    const [mine, open] = await Promise.all([api.myActiveJobs(), api.openJobs()]);
    return { mine, open };
  }, { pollMs: 15000 });
  const accept = async (id) => {
    setAccepting(id); setError(null);
    try { await api.accept(id); router.push(`/job/${id}`); jobs.reload(); }
    catch (e) { setError(e); jobs.reload(); } finally { setAccepting(null); }
  };
  const mine = jobs.data?.mine || [];
  const open = jobs.data?.open || [];
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}
      refreshControl={<RefreshControl refreshing={jobs.refreshing} onRefresh={jobs.refresh} tintColor={colors.teal} />}>
      <OnlineCard />
      <ErrorBox error={error || jobs.error} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <H2>Your jobs</H2>
        <Button title="Scan" icon="▦" variant="secondary" onPress={() => router.push('/scan')} style={{ minHeight: 40 }} />
      </View>
      {jobs.loading ? <Muted>Loading…</Muted> : mine.length === 0 ? <Muted>No active jobs. Accept one below.</Muted>
        : mine.map((o) => (
          <JobCard key={o.id} order={o} onPress={() => router.push(`/job/${o.id}`)}
            footer={<Button title="Continue →" onPress={() => router.push(`/job/${o.id}`)} />} />
        ))}
      <H2 style={{ marginTop: 8 }}>Available jobs</H2>
      {jobs.loading ? null : open.length === 0
        ? <Card><Muted>No open jobs right now. They show up here automatically, and you'll get an alert while you're online.</Muted></Card>
        : open.map((o) => (
          <JobCard key={o.id} order={o} onPress={() => router.push(`/job/${o.id}`)}
            footer={<Button title="Accept job" loading={accepting === o.id} onPress={() => accept(o.id)} />} />
        ))}
    </ScrollView>
  );
}
