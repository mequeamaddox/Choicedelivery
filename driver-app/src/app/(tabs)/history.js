import { useState } from 'react';
import { Alert, Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../lib/client';
import { formatDate, formatMoney } from '../../lib/api';
import { useLoader } from '../../lib/useLoader';
import { colors } from '../../lib/theme';
import { Badge, Button, Card, ErrorBox, H2, Muted, Notice } from '../../components/ui';
import JobCard from '../../components/JobCard';

function Stat({ label, cents }) {
  return (
    <Card style={{ flex: 1, gap: 2, padding: 12 }}>
      <Muted small>{label}</Muted>
      <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{formatMoney(cents)}</Text>
    </Card>
  );
}

// Getting paid: set up direct deposit once in Stripe's secure form (bank account, plus a debit card for
// instant pay), then wait for the free Wednesday bank deposit or get paid now to the debit card for a fee.
// The screen reloads (re-checking the setup) when the driver comes back to the app.
function Payouts({ setup, dest, earnings, onPaid }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  if (!setup?.available || !earnings) return null;
  const e = earnings;
  const setUp = async () => {
    setBusy(true); setError(null);
    try { await Linking.openURL((await api.startPayoutSetup()).url); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const changeMethod = async () => {
    setBusy(true); setError(null);
    try { await Linking.openURL((await api.payoutMethodLink()).url); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const send = async () => {
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await api.instantPayout(e.instant.netCents);
      setDone(r.instant
        ? `${formatMoney(r.netCents)} is on its way to your debit card. It usually arrives within 30 minutes.`
        : `Your bank can't take instant payments, so we sent the full ${formatMoney(r.netCents)} by regular bank deposit (1–2 business days), no fee.`);
      onPaid();
    } catch (err) { setError(err); } finally { setBusy(false); }
  };
  const payNow = () => Alert.alert(
    `Get ${formatMoney(e.instant.netCents)} now?`,
    `A ${formatMoney(e.instant.feeCents)} fee ($1.50 + 1.5%) comes out of your ${formatMoney(e.owedCents)}. It goes to your debit card, usually within 30 minutes.`,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Get paid now', onPress: send }],
  );
  const next = e.nextPayoutAt && new Date(e.nextPayoutAt).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <H2>Getting paid</H2>
        {setup.payoutsEnabled ? <Badge label="Direct deposit on" tone="green" /> : setup.connected ? <Badge label="Not finished" tone="amber" /> : null}
      </View>
      <ErrorBox error={error} />
      {done ? <Notice tone="green">{done}</Notice> : null}
      {!setup.payoutsEnabled ? (
        <>
          <Muted small>
            {setup.connected ? 'Finish your direct-deposit setup to get paid.'
              : 'Add your bank account (and a debit card if you want instant pay). Stripe, our payments partner, keeps them secure; it takes about 5 minutes.'}
          </Muted>
          <Button title={setup.connected ? 'Finish direct-deposit setup' : 'Set up direct deposit'} loading={busy} onPress={setUp} />
        </>
      ) : (
        <>
          <View style={{ gap: 2 }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Free bank deposit</Text>
            <Muted small>Everything you're owed goes to your bank {next ? `on ${next}` : 'every Wednesday at 9 AM'}. Arrives in 1–2 business days.</Muted>
          </View>
          <View style={{ gap: 6 }}>
            <Text style={{ fontWeight: '700', color: colors.text }}>Instant to your debit card</Text>
            <Muted small>$1.50 + 1.5% fee. Usually arrives within 30 minutes.</Muted>
            {e.owedCents > 0 ? (
              <Button title={`Get ${formatMoney(e.instant.netCents)} now`} loading={busy} disabled={!e.instant.available} onPress={payNow} />
            ) : null}
            {e.owedCents > 0 && !e.instant.available ? <Muted small>Not enough owed yet for instant pay.</Muted> : null}
            {dest && !dest.instantMethod ? <Muted small>Add a debit card below to use instant pay.</Muted> : null}
          </View>
          {dest?.method ? <Muted small>Paying to {dest.method.label}{dest.instantMethod && dest.instantMethod.label !== dest.method.label ? ` · instant to ${dest.instantMethod.label}` : ''}</Muted> : null}
          <Button title="Change bank or debit card" variant="secondary" loading={busy} onPress={changeMethod} />
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
    const dest = setup?.payoutsEnabled ? await api.payoutMethod().catch(() => null) : null;
    return { orders, earnings, setup, dest };
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
      <Payouts setup={done.data?.setup} dest={done.data?.dest} earnings={e} onPaid={done.refresh} />
      {done.loading ? <Muted>Loading…</Muted> : !orders?.length ? <Card><Muted>No completed deliveries yet.</Muted></Card>
        : <Muted small>{orders.length} completed deliveries</Muted>}
      {(orders || []).map((o) => (
        <JobCard key={o.id} order={o} onPress={() => router.push(`/job/${o.id}`)}
          footer={<Muted small>Delivered {formatDate(o.completedAt)} · {o.driverPaidAt ? `paid ${formatDate(o.driverPaidAt)}` : 'not paid out yet'}</Muted>} />
      ))}
    </ScrollView>
  );
}
