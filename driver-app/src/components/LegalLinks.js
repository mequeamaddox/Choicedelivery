// Links to the website's Terms & Conditions and Privacy Policy.
import { Linking, Text } from 'react-native';
import { colors } from '../lib/theme';

export const TERMS_URL = 'https://choicedeliverysc.com/terms';
export const PRIVACY_URL = 'https://choicedeliverysc.com/privacy';

export default function LegalLinks({ style }) {
  const link = { color: colors.teal, fontWeight: '600', textDecorationLine: 'underline' };
  return (
    <Text style={[{ color: colors.muted || '#6B7280', fontSize: 13, textAlign: 'center' }, style]}>
      <Text style={link} accessibilityRole="link" onPress={() => Linking.openURL(TERMS_URL)}>Terms & Conditions</Text>
      {' · '}
      <Text style={link} accessibilityRole="link" onPress={() => Linking.openURL(PRIVACY_URL)}>Privacy Policy</Text>
    </Text>
  );
}
