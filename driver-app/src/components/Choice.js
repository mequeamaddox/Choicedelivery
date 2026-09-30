import { Pressable, Text, View } from 'react-native';
import { colors } from '../lib/theme';

// A row of pill buttons to pick one option (vehicle type, etc.).
export default function Choice({ options, value, onChange }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = value === o;
        return (
          <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="radio" accessibilityState={{ selected: on }}
            style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1,
              borderColor: on ? colors.teal : colors.border, backgroundColor: on ? colors.mintBg : '#fff' }}>
            <Text style={{ color: on ? colors.tealDark : colors.text, fontWeight: '600' }}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
