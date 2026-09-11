import { StyleSheet } from 'react-native';

import type { BrandTokens } from '@platform/ui';

export const createGiftScreenStyles = (tokens: BrandTokens) => StyleSheet.create({
  myCards: { height: 180, borderRadius: tokens.radius.lg, overflow: 'hidden', justifyContent: 'center' },
  myCardsCopy: { width: '68%', padding: tokens.spacing.xl, gap: tokens.spacing.md },
  myCardsTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 26 },
  giftGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.lg },
  cardList: { gap: tokens.spacing.sm },
  design: { width: '47%', aspectRatio: 1.32, borderRadius: tokens.radius.lg, overflow: 'hidden', justifyContent: 'space-between', padding: tokens.spacing.lg },
  designMark: { color: tokens.surfaceElevated, fontFamily: tokens.fontDisplay, fontSize: 24 },
  designTitle: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 15 },
  preview: { height: 220, borderRadius: tokens.radius.lg, overflow: 'hidden', padding: tokens.spacing.xl, justifyContent: 'space-between' },
  previewMark: { color: tokens.surfaceElevated, fontFamily: tokens.fontDisplay, fontSize: 26 },
  previewAmount: { color: tokens.surfaceElevated, fontFamily: tokens.fontDisplay, fontSize: 58, alignSelf: 'flex-end' },
  amounts: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.md },
  amount: { minWidth: 70, height: 48, borderRadius: tokens.radius.pill, borderWidth: 1, borderColor: tokens.secondary, alignItems: 'center', justifyContent: 'center' },
  deliveryChoice: { minHeight: 48, borderRadius: tokens.radius.pill, borderWidth: 1, borderColor: tokens.secondary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.spacing.lg },
  amountActive: { backgroundColor: tokens.primary, borderColor: tokens.primary },
  amountText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  amountTextActive: { color: tokens.surfaceElevated },
  field: { gap: tokens.spacing.md },
  fieldLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  input: { minHeight: 54, borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: tokens.textMuted, paddingHorizontal: tokens.spacing.lg, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15, backgroundColor: tokens.surfaceElevated },
  multiline: { minHeight: 104, paddingTop: tokens.spacing.lg, textAlignVertical: 'top' },
  legal: { padding: tokens.spacing.lg, backgroundColor: tokens.surface },
  error: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13 },
  sent: { minHeight: '100%', justifyContent: 'center', paddingBottom: 140 },
  sentMark: { width: 104, height: 104, borderRadius: 52, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.surface },
  sentMarkText: { color: tokens.primary, fontFamily: tokens.fontDisplay, fontSize: 32 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
