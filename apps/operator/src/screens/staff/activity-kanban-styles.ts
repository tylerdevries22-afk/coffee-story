import { StyleSheet } from 'react-native';
import type { BrandTokens } from '@platform/ui';

export function activityKanbanStyles(tokens: BrandTokens) {
  return StyleSheet.create({
    summary: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: tokens.success },
    summaryText: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
    board: { gap: 14, paddingBottom: 24 },
    boardWide: { flexDirection: 'row', alignItems: 'flex-start' },
    lane: { backgroundColor: tokens.surfaceElevated, borderRadius: tokens.radius.lg,
      padding: tokens.spacing.md, borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.secondary, gap: tokens.spacing.md },
    laneHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    laneTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 20 },
    count: { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: tokens.surface,
      color: tokens.textPrimary, textAlign: 'center', lineHeight: 28,
      fontFamily: tokens.fontBody, fontSize: 12 },
    empty: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13,
      paddingVertical: tokens.spacing.lg },
    card: { borderRadius: tokens.radius.md, padding: tokens.spacing.md,
      backgroundColor: tokens.surface, gap: 10, borderLeftWidth: 3, borderLeftColor: tokens.accent },
    pressed: { opacity: 0.72 },
    audience: { color: tokens.accent, fontFamily: tokens.fontBody, fontSize: 11,
      letterSpacing: 0.7, textTransform: 'uppercase' },
    title: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 18, lineHeight: 22 },
    meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    time: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
    actor: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
    avatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center',
      justifyContent: 'center', backgroundColor: tokens.primary },
    avatarText: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 10 },
    actorName: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, flexShrink: 1 },
    error: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13, marginBottom: 12 },
  });
}
