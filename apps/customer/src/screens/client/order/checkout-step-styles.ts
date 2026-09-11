import { StyleSheet } from 'react-native';

import type { BrandTokens } from '@platform/ui';

export const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  page: { backgroundColor: tokens.surface },
  content: { gap: tokens.spacing.lg },
  pressed: { opacity: 0.72 },

  card: { borderRadius: tokens.radius.lg, backgroundColor: tokens.surfaceElevated, padding: tokens.spacing.xl, gap: tokens.spacing.md },
  cardTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20, marginBottom: tokens.spacing.sm },

  receiptRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: tokens.spacing.lg },
  receiptLabel: { flex: 1, color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14, lineHeight: 20 },
  receiptValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14, lineHeight: 20 },

  tipRow: { flexDirection: 'row', gap: tokens.spacing.md, marginTop: tokens.spacing.md },
  tipChip: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.secondary,
    backgroundColor: tokens.surfaceElevated,
  },
  tipChipSelected: { borderColor: tokens.primary, backgroundColor: tokens.surface },
  tipChipText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  tipChipTextSelected: { color: tokens.primary, fontFamily: tokens.fontBody },
  tipInput: {
    minHeight: 52,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.primary,
    backgroundColor: tokens.surfaceElevated,
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 16,
    paddingHorizontal: tokens.spacing.lg,
  },
  tipCaption: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },

  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: tokens.spacing.md,
    paddingTop: tokens.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.secondary,
  },
  totalLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20 },
  totalValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20 },

  paymentSkeleton: { paddingVertical: tokens.spacing.sm },
  paymentRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.secondary,
  },
  paymentLabel: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  defaultChip: { paddingHorizontal: tokens.spacing.md, paddingVertical: 3, borderRadius: tokens.radius.pill, backgroundColor: tokens.surface },
  defaultChipText: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 11 },

  promoRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
    alignSelf: 'flex-start',
    paddingHorizontal: tokens.spacing.lg,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surface,
  },
  toggleHint: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  promoLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },

  legal: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11, lineHeight: 16, fontStyle: 'italic' },
  legalQuiet: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11, fontStyle: 'italic' },

  simulated: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, lineHeight: 18 },
  error: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 19 },
});
