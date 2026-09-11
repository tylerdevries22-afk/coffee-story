import type { ComponentProps } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

export function Field({ label, ...props }: ComponentProps<typeof TextInput> & { label: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={`${label} input`}
        {...props}
        placeholderTextColor={tokens.textMuted}
        style={[styles.input, props.multiline && styles.multiline]}
      />
    </View>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  field: { gap: tokens.spacing.sm },
  fieldLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  input: {
    minHeight: 54,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.textMuted,
    paddingHorizontal: tokens.spacing.lg,
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 15,
    backgroundColor: tokens.surfaceElevated,
  },
  multiline: { minHeight: 110, paddingTop: tokens.spacing.lg, textAlignVertical: 'top' },
});
