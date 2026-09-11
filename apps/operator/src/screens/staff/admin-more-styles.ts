import { StyleSheet } from 'react-native';

import type { AppTokens } from '@platform/ui';

export function createAdminMoreStyles({ colors, fonts, radius, spacing }: AppTokens) {
  return StyleSheet.create({
    content: {
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xxl,
      backgroundColor: colors.warm,
    },
    pageTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 24, marginBottom: spacing.xs },
    groupWrap: { gap: spacing.xs },
    groupLabel: {
      color: colors.ink700,
      fontFamily: fonts.sansBold,
      fontSize: 13,
      paddingHorizontal: spacing.xs,
    },
    group: {
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.ink200,
      borderRadius: radius.sm,
      backgroundColor: colors.white,
    },
    row: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.white,
    },
    rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ink200 },
    rowIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
    rowSubtitle: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 13, marginTop: 2 },
    pressed: { backgroundColor: colors.brand50 },
    previewPicker: { padding: spacing.sm },
    version: { color: colors.ink400, fontFamily: fonts.sans, fontSize: 12, paddingHorizontal: spacing.xs },
  });
}
