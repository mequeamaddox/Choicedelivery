import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../lib/client';
import { formatDate, formatMoney } from '../../lib/api';
import { useLoader } from '../../lib/useLoader';
import { colors } from '../../lib/theme';
import { Card, ErrorBox, Muted } from '../../components/ui';
import JobCard from '../../components/JobCard';

function Stat({ label, cents }) {
  return (
    <Card style={{ flex: 1, gap: 2, padding: 12 }}>
      <Muted small>{label}</Muted>
      <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{formatMoney(cents)}</Text>
    </Card>
  );
}

// Completed deliveries with what each paid, and earnings totals at the top.
export default function History() {
  const router = useRouter();
  const done = useLoader(async () => {
    const [orders, earnings] = await Promise.all([api.history(), api.earnings()]);
    return { orders, earnings };
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
      {done.loading ? <Muted>Loading…</Muted> : !orders?.length ? <Card><Muted>No completed deliveries yet.</Muted></Card>
        : <Muted small>{orders.length} completed deliveries</Muted>}
      {(orders || []).map((o) => (
        <JobCard key={o.id} order={o} onPress={() => router.push(`/job/${o.id}`)}
          footer={<Muted small>Delivered {formatDate(o.completedAt)} · {o.driverPaidAt ? `paid ${formatDate(o.driverPaidAt)}` : 'not paid out yet'}</Muted>} />
      ))}
    </ScrollView>
  );
}
