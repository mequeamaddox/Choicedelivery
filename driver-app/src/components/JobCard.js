import { Pressable, Text, View } from 'react-native';
import { colors } from '../lib/theme';
import { formatDate, formatMoney } from '../lib/api';
import { Badge, Card, Muted } from './ui';

const short = (address) => (address || '').split(',').slice(0, 2).join(',');

// One job in a list: order number, status, route and the key facts a driver decides on.
export default function JobCard({ order, onPress, footer }) {
  const first = order.stops[0];
  const last = order.stops[order.stops.length - 1];
  const extras = [
    order.vehicleType,
    order.distanceMiles != null ? `${order.distanceMiles} mi` : null,
    order.numberOfPieces ? `${order.numberOfPieces} pc` : null,
    order.weight || null,
    order.stops.length > 2 ? `${order.stops.length} stops` : null,
  ].filter(Boolean);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Job ${order.orderNumber}`}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: colors.text }}>{order.orderNumber}</Text>
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {order.driverPayCents != null ? (
              <Text style={{ fontSize: 17, fontWeight: '800', color: colors.teal }} accessibilityLabel={`Pays ${formatMoney(order.driverPayCents)}`}>
                {formatMoney(order.driverPayCents)}
              </Text>
            ) : null}
            {order.serviceLevel === 'rush' ? <Badge label="RUSH" tone="red" /> : null}
            <Badge status={order.status} />
          </View>
        </View>
        <View style={{ gap: 4 }}>
          {[['From', first, colors.teal], ['To', last, colors.blue]].map(([label, stop, color]) => (
            <View key={label} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ width: 42, fontSize: 15, fontWeight: '700', color }}>{label}</Text>
              <Text style={{ flex: 1, fontSize: 15, color: colors.text }}>{short(stop?.address)}</Text>
            </View>
          ))}
        </View>
        {extras.length ? <Muted small>{extras.join(' · ')}</Muted> : null}
        {order.scheduledAt ? <Muted small>Pickup {formatDate(order.scheduledAt)}</Muted> : null}
        {footer}
      </Card>
    </Pressable>
  );
}
