import { StyleSheet } from 'react-native';

import type { BrandTokens } from '@platform/ui';

export const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  shell: { flex: 1, backgroundColor: tokens.surface },
  pressed: { opacity: 0.72 },

  pills: {
    gap: tokens.spacing.sm,
    paddingHorizontal: tokens.spacing.xl,
    paddingBottom: tokens.spacing.md,
    backgroundColor: tokens.surface,
  },
  pausedBanner: {
    paddingHorizontal: tokens.spacing.xl,
    paddingVertical: tokens.spacing.md,
    backgroundColor: tokens.surface,
  },
  pausedText: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 14 },
  pill: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surfaceElevated,
  },
  pillLabel: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },
  pillDetail: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
  pillAction: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 13 },

  scroll: { paddingBottom: tokens.spacing.xxl },

  section: { paddingTop: tokens.spacing.xl },
  sectionHeader: { paddingHorizontal: tokens.spacing.xl, paddingBottom: tokens.spacing.md, gap: 2 },
  sectionTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 22, lineHeight: 28 },
  sectionTagline: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },

  rowSoldOut: { opacity: 0.55 },
  row: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.lg,
    paddingHorizontal: tokens.spacing.xl,
    paddingVertical: tokens.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.secondary,
  },
  rowHighlighted: { backgroundColor: tokens.surface },
  rowCopy: { flex: 1, gap: 2 },
  rowName: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  rowPrice: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  rowDescription: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 18 },
});
