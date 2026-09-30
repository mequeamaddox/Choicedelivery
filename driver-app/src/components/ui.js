// Small set of shared building blocks so every screen looks the same.
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, STATUS, TONES } from '../lib/theme';

export function Card({ children, style }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function H1({ children, style }) {
  return <Text style={[styles.h1, style]}>{children}</Text>;
}

export function H2({ children, style }) {
  return <Text style={[styles.h2, style]}>{children}</Text>;
}

export function Muted({ children, style, small }) {
  return <Text style={[styles.muted, small && styles.small, style]}>{children}</Text>;
}

// variant: primary | secondary | danger | ghost. big: tall button for the main action on a screen.
export function Button({ title, onPress, variant = 'primary', big, disabled, loading, icon, style, accessibilityLabel }) {
  const v = VARIANTS[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      style={({ pressed }) => [
        styles.button, big && styles.buttonBig, { backgroundColor: v.bg, borderColor: v.border },
        (pressed || loading) && { opacity: 0.85 }, disabled && { opacity: 0.5 }, style,
      ]}>
      {loading ? <ActivityIndicator color={v.fg} /> : (
        <Text style={[styles.buttonText, big && styles.buttonTextBig, { color: v.fg }]}>{icon ? `${icon}  ` : ''}{title}</Text>
      )}
    </Pressable>
  );
}

const VARIANTS = {
  primary: { bg: colors.teal, fg: '#fff', border: colors.teal },
  secondary: { bg: '#fff', fg: colors.text, border: colors.border },
  danger: { bg: '#fff', fg: colors.red, border: '#FCA5A5' },
  ghost: { bg: 'transparent', fg: colors.teal, border: 'transparent' },
};

export function Badge({ status, label, tone }) {
  const s = status ? STATUS[status] || { label: status, tone: 'gray' } : { label, tone };
  const [bg, fg] = TONES[s.tone] || TONES.gray;
  return <Text style={[styles.badge, { backgroundColor: bg, color: fg }]}>{s.label}</Text>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <Text style={styles.error} accessibilityRole="alert">{error.message || String(error)}</Text>;
}

export function Notice({ children, tone = 'amber' }) {
  const [bg, fg] = TONES[tone];
  return <View style={[styles.notice, { backgroundColor: bg }]}><Text style={{ color: fg, fontSize: 14, lineHeight: 20 }}>{children}</Text></View>;
}

export function Field({ label, hint, ...props }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor="#9CA3AF" style={styles.input} {...props} />
      {hint ? <Muted small>{hint}</Muted> : null}
    </View>
  );
}

export function Row({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

export function Loading() {
  return <View style={styles.loading}><ActivityIndicator size="large" color={colors.teal} /></View>;
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card, borderRadius: 14, padding: 16, gap: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  h1: { fontSize: 24, fontWeight: '800', color: colors.text },
  h2: { fontSize: 18, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted, fontSize: 15, lineHeight: 21 },
  small: { fontSize: 13, lineHeight: 18 },
  button: {
    minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  buttonBig: { minHeight: 58 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  buttonTextBig: { fontSize: 18 },
  badge: {
    alignSelf: 'flex-start', overflow: 'hidden', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
    fontSize: 12, fontWeight: '700',
  },
  error: { backgroundColor: colors.redBg, color: colors.red, padding: 12, borderRadius: 10, fontSize: 15 },
  notice: { padding: 12, borderRadius: 10 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, backgroundColor: '#fff', color: colors.text,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 2 },
  rowLabel: { color: colors.muted, fontSize: 15 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
});
