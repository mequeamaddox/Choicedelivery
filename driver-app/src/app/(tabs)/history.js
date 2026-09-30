import { RefreshControl, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../lib/client';
import { formatDate } from '../../lib/api';
import { useLoader } from '../../lib/useLoader';
import { colors } from '../../lib/theme';
import { Card, ErrorBox, Muted } from '../../components/ui';
import JobCard from '../../components/JobCard';

export default function History() {
  const router = useRouter();
  const done = useLoader(() => api.history());
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={done.refreshing} onRefresh={done.refresh} tintColor={colors.teal} />}>
      <ErrorBox error={done.error} />
      {done.loading ? <Muted>Loading…</Muted> : !done.data?.length ? <Card><Muted>No completed deliveries yet.</Muted></Card>
        : <Muted small>{done.data.length} completed deliveries</Muted>}
      {(done.data || []).map((o) => (
        <JobCard key={o.id} order={o} onPress={() => router.push(`/job/${o.id}`)}
          footer={<Muted small>Delivered {formatDate(o.completedAt)}</Muted>} />
      ))}
    </ScrollView>
  );
}
