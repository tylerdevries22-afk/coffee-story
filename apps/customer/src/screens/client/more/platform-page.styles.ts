import { StyleSheet } from 'react-native';

import type { BrandTokens } from '@platform/ui';

export const createPlatformPageStyles = (tokens: BrandTokens) => StyleSheet.create({
  dropRow: { flexDirection: 'row', gap: tokens.spacing.lg, alignItems: 'center' },
  dropBody: { flex: 1, gap: tokens.spacing.sm },
  endedLabel: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  fieldLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },
  field: {
    borderWidth: 1,
    borderColor: tokens.secondary,
    borderRadius: tokens.radius.lg,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 15,
    backgroundColor: tokens.surfaceElevated,
  },
  fieldTall: { minHeight: 88, textAlignVertical: 'top' },
  codeLabel: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  code: {
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 24,
    letterSpacing: 1,
  },
});
