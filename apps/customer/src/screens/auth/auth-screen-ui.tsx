import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

export function AuthField({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  const tokens = useBrandTokens();
  const styles = createAuthStyles(tokens);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        {...props}
        placeholderTextColor={tokens.textMuted}
        style={styles.input}
      />
    </View>
  );
}

export function AuthLink({ label, onPress }: { label: string; onPress: () => void }) {
  const tokens = useBrandTokens();
  const styles = createAuthStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
    >
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

export const createAuthStyles = (tokens: BrandTokens) => StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', paddingBottom: tokens.spacing.xxl },
  intro: { gap: tokens.spacing.md, marginBottom: tokens.spacing.lg },
  form: { gap: tokens.spacing.lg },
  field: { gap: tokens.spacing.md },
  label: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  input: {
    minHeight: 56,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.textMuted,
    paddingHorizontal: tokens.spacing.lg,
    backgroundColor: tokens.surfaceElevated,
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 16,
  },
  error: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 19 },
  links: { alignItems: 'center', gap: tokens.spacing.lg },
  linkButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: tokens.spacing.lg },
  link: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 14 },
  pressed: { opacity: 0.72 },
});
