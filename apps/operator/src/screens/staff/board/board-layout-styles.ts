import {
  StyleSheet
} from 'react-native';

import { type BrandTokens } from '@platform/ui';


export const createBoardLayoutStyles = (tokens: BrandTokens) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: tokens.surface },
  pressed: { opacity: 0.8 },

  header: {
    gap: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.xl,
    paddingBottom: tokens.spacing.md,
  },
  headerMain: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacing.md, minHeight: 44 },
  headerTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 24, flexShrink: 0 },
  headerChip: {
    maxWidth: '48%',
    minHeight: 44,
    flexShrink: 1,
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surface,
  },
  headerChipText: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 13, flexShrink: 1 },
  headerActions: { flexDirection: 'row', gap: tokens.spacing.md, paddingRight: tokens.spacing.xs },
  headerButton: {
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surfaceElevated,
    borderWidth: 1,
    borderColor: tokens.secondary,
  },
  headerButtonText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },
  newBadge: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.danger,
  },
  newBadgeText: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 13 },

  conflictBanner: { gap: tokens.spacing.sm, paddingHorizontal: tokens.spacing.xl, paddingBottom: tokens.spacing.md },
  conflictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.danger,
    backgroundColor: tokens.surfaceElevated,
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
  },
  conflictText: { flex: 1, color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 18 },
  conflictDismiss: { minHeight: 32, justifyContent: 'center', paddingHorizontal: tokens.spacing.sm },
  conflictDismissText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 12, textDecorationLine: 'underline' },

  lane: { paddingBottom: tokens.spacing.md },
  laneTitle: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: tokens.spacing.xl, paddingBottom: tokens.spacing.sm },
  laneRow: { gap: tokens.spacing.md, paddingHorizontal: tokens.spacing.xl },
  laneCard: {
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: tokens.spacing.md,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
    borderWidth: 1,
    borderColor: tokens.accent,
    alignItems: 'center',
    gap: 2,
  },
  laneCode: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  laneWhen: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },

  columnsScroll: { flex: 1 },
  columns: { paddingHorizontal: tokens.spacing.xl, gap: tokens.spacing.lg, paddingBottom: tokens.spacing.xxl },
  // Side-by-side columns above the breakpoint; the vertical ScrollView's
  // content container needs the row direction stated, or the columns stack.
  columnsWide: { flex: 1, flexDirection: 'row' },
  column: {
    flex: 1,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
    padding: tokens.spacing.md,
  },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, padding: tokens.spacing.md },
  columnDot: { width: 10, height: 10, borderRadius: 5 },
  columnTitle: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  columnCount: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 16 },
  columnBody: { gap: tokens.spacing.md, paddingBottom: tokens.spacing.xl },
  columnEmpty: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14, textAlign: 'center', paddingVertical: tokens.spacing.xxl },

  card: {
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surfaceElevated,
    padding: tokens.spacing.lg,
    gap: tokens.spacing.sm,
    shadowColor: tokens.textPrimary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: tokens.elevation.card, shadowRadius: 24, elevation: 5,
  },
  cardFresh: { borderWidth: 2, borderColor: tokens.danger },
  cardTop: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: tokens.spacing.md },
  cardCode: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 18 },
  cardCodeKds: { fontSize: 26 },
  cardQueue: {
    color: tokens.textMuted ?? tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  cardGuest: { flex: 1, minWidth: 80, color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14 },
  cardAge: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  cardLine: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14, lineHeight: 20 },
  cardLineKds: { fontSize: 18, lineHeight: 26 },
  cardNote: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 13, fontStyle: 'italic' },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: tokens.spacing.sm },
  cardTotal: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14 },
  advance: {
    minHeight: 44,
    minWidth: 110,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.xl,
  },
  advanceText: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 15 },

});
