import { StyleSheet } from 'react-native';

import type { BrandTokens } from '@platform/ui';

export const createProfileStyles = (tokens: BrandTokens) => StyleSheet.create({
  avatarHeader: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.xl, paddingVertical: tokens.spacing.md },
  avatarCopy: { flex: 1, gap: tokens.spacing.sm },
  profileName: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 25, lineHeight: 30 },
  accessCard: { gap: tokens.spacing.lg },
});
