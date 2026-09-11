import { StyleSheet } from 'react-native';

import type { BrandTokens } from '@platform/ui';

export const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  sheet: {
    maxHeight: '94%',
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
    overflow: 'hidden',
  },
  body: { flexShrink: 1 },
  scroll: { paddingBottom: tokens.spacing.xl, gap: tokens.spacing.xl },
  pressed: { opacity: 0.72 },

  // No fixed height: the hero is as tall as the square master is wide, so it
  // shows the identical framing the thumbnails do.
  hero: { backgroundColor: tokens.surface },
  close: {
    position: 'absolute',
    top: tokens.spacing.lg,
    left: tokens.spacing.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.surface,
  },

  copy: { paddingHorizontal: tokens.spacing.xl, gap: tokens.spacing.sm },
  name: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 28, lineHeight: 34 },
  description: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15, lineHeight: 22 },

  block: { paddingHorizontal: tokens.spacing.xl, gap: tokens.spacing.md },
  blockTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 18 },
  quantityBlock: { gap: tokens.spacing.md },

  error: { paddingHorizontal: tokens.spacing.xl, color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13 },

  footer: {
    paddingHorizontal: tokens.spacing.xl,
    paddingTop: tokens.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.secondary,
    backgroundColor: tokens.surface,
  },
});
