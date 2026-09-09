import { StyleSheet } from 'react-native';

import type { BrandTokens } from '@platform/ui';

export const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  batchRow: { marginBottom: tokens.spacing.lg },
  batchCard: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.lg, minHeight: 96 },
  batchCopy: { flex: 1, gap: 4 },
  batchName: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 26 },
  statusPill: { paddingHorizontal: tokens.spacing.lg, paddingVertical: 10, borderRadius: tokens.radius.pill },
  statusText: { fontFamily: tokens.fontBody, fontSize: 16 },
  allergens: {
    backgroundColor: tokens.surfaceElevated,
    borderRadius: tokens.radius.lg,
    padding: tokens.spacing.lg,
    gap: 4,
    marginBottom: tokens.spacing.lg,
  },
  allergensLabel: {
    color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 14,
    letterSpacing: 1.2, textTransform: 'uppercase',
  },
  allergensList: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 22 },
  steps: { gap: tokens.spacing.lg, paddingBottom: tokens.spacing.xxl },
  step: { flexDirection: 'row', gap: tokens.spacing.lg, alignItems: 'flex-start' },
  stepNumber: { color: tokens.primary, fontFamily: tokens.fontDisplay, fontSize: 34, minWidth: 40 },
  stepCopy: { flex: 1, gap: 6 },
  stepText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 22, lineHeight: 30 },
  stepQuantity: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 22 },
  action: {
    minHeight: 84, borderRadius: tokens.radius.pill, backgroundColor: tokens.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: tokens.spacing.lg,
  },
  actionLabel: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 24 },
  pressed: { opacity: 0.85 },
});
