import { useState } from 'react';
import { Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../lib/client';
import { formatDate, formatMoney } from '../../lib/api';
import { useLoader } from '../../lib/useLoader';
import { colors } from '../../lib/theme';
import { Badge, Button, Card, ErrorBox, H2, Muted } from '../../components/ui';
import JobCard from '../../components/JobCard';

function Stat({ label, cents }) {
  return (
    <Card style={{ flex: 1, gap: 2, padding: 12 }}>
      <Muted small>{label}</Muted>
      <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{formatMoney(cents)}</Text>
    </Card>
  );
}

// Direct deposit through Stripe. Sign-up happens on Stripe's site in the browser; the screen reloads
// (and re-checks the status) when the driver comes back to the app.
function DirectDeposit({ setup }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  if (!setup?.available) return null;
  const open = (fn) => async () => {
    setBusy(true); setError(null);
    try { await Linking.openURL((await fn()).url); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <H2>Direct deposit</H2>
        {setup.payoutsEnabled ? <Badge label="Ready" tone="green" /> : setup.connected ? <Badge label="Not finished" tone="amber" /> : null}
      </View>
      <ErrorBox error={error} />
      {setup.payoutsEnabled ? (
        <>
          <Muted small>Your pay goes straight to your bank through Stripe. See payouts, change your bank or get tax forms in Stripe.</Muted>
          <Button title="Open my Stripe payouts" variant="secondary" loading={busy} onPress={open(api.payoutDashboard)} />
        </>
      ) : (
        <>
          <Muted small>
            {setup.connected ? 'Finish your Stripe setup to get paid by direct deposit.'
              : 'Get paid straight to your bank. Stripe, our payments partner, securely collects your bank and tax details (about 5 minutes).'}
          </Muted>
          <Button title={setup.connected ? 'Finish direct-deposit setup' : 'Set up direct deposit'} loading={busy} onPress={open(api.startPayoutSetup)} />
        </>
      )}
    </Card>
  );
}

// Completed deliveries with what each paid, and earnings totals at the top.
export default function History() {
  const router = useRouter();
  const done = useLoader(async () => {
    const [orders, earnings, setup] = await Promise.all([api.history(), api.earnings(), api.payoutSetup().catch(() => null)]);
    return { orders, earnings, setup };
  });
  const orders = done.data?.orders;
  const e = done.data?.earnings;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={done.refreshing} onRefresh={done.refresh} tintColor={colors.teal} />}>
      <ErrorBox error={done.error} />
      {e ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat label="Owed to you" cents={e.owedCents} />
          <Stat label="Last 7 days" cents={e.last7DaysCents} />
          <Stat label="Paid (60 days)" cents={e.paidLast60DaysCents} />
        </View>
      ) : null}
      <DirectDeposit setup={done.data?.setup} />
      {done.loading ? <Muted>Loading…</Muted> : !orders?.length ? <Card><Muted>No completed deliveries yet.</Muted></Card>
        : <Muted small>{orders.length} completed deliveries</Muted>}
      {(orders || []).map((o) => (
        <JobCard key={o.id} order={o} onPress={() => router.push(`/job/${o.id}`)}
          footer={<Muted small>Delivered {formatDate(o.completedAt)} · {o.driverPaidAt ? `paid ${formatDate(o.driverPaidAt)}` : 'not paid out yet'}</Muted>} />
      ))}
    </ScrollView>
  );
}
