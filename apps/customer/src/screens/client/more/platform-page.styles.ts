import { StyleSheet } from 'react-native';

import type { BrandTokens } from '@platform/ui';

export const createPlatformPageStyles = (tokens: BrandTokens) => StyleSheet.create({
  dropRow: { flexDirection: 'row', gap: tokens.spacing.lg, alignItems: 'center' },
  dropBody: { flex: 1, gap: tokens.spacing.sm },
  endedLabel: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  codeLabel: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  code: {
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 24,
    letterSpacing: 1,
  },
});
