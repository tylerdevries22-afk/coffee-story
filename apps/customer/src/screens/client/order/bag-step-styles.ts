import { StyleSheet } from 'react-native';

import { menuImageFrame, type BrandTokens } from '@platform/ui';

const LINE_FRAME = menuImageFrame('line');

export const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  page: { backgroundColor: tokens.surface },
  content: { gap: tokens.spacing.lg },

  contextCard: { borderRadius: tokens.radius.lg, backgroundColor: tokens.surfaceElevated, paddingHorizontal: tokens.spacing.lg },
  contextRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md },
  contextDivider: { height: StyleSheet.hairlineWidth, backgroundColor: tokens.secondary },
  contextCopy: { flex: 1 },
  contextLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  contextDetail: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
  contextEditButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  contextEdit: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 14 },
  pressed: { opacity: 0.72 },

  empty: { gap: tokens.spacing.sm, paddingVertical: tokens.spacing.xxl },
  emptyTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20 },

  line: { borderRadius: tokens.radius.lg, backgroundColor: tokens.surfaceElevated, padding: tokens.spacing.lg, gap: tokens.spacing.md },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: tokens.spacing.lg },
  // Empty state for a line whose item has no photograph. Sized from the same
  // frame MenuImage uses, so the two cannot drift apart.
  lineImage: { width: LINE_FRAME.size, height: LINE_FRAME.size, borderRadius: tokens.radius.md, backgroundColor: tokens.surface },
  lineCopy: { flex: 1, gap: 3 },
  lineName: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  lineSummary: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, lineHeight: 17 },
  lineUnit: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14 },
  lineBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineTotal: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },

  subtotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: tokens.spacing.sm },
  subtotalLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20 },
  subtotalValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 20 },

  noteEcho: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: tokens.spacing.md,
    padding: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
  },
  noteEchoText: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 18 },

  noteField: { gap: tokens.spacing.sm },
  noteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },
  noteCount: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
  noteInput: {
    minHeight: 108,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.secondary,
    backgroundColor: tokens.surfaceElevated,
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 16,
    padding: tokens.spacing.lg,
    textAlignVertical: 'top',
  },
});
