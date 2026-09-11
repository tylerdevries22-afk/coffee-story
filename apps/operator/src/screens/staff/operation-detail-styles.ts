import { StyleSheet } from 'react-native';

import type { BrandTokens } from '@platform/ui';

export function createStyles(tokens: BrandTokens) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: tokens.surface }, flex: { flex: 1 },
    header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: tokens.spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: tokens.secondary },
    headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 17, fontWeight: '700' },
    content: { padding: tokens.spacing.lg, paddingBottom: 80, gap: tokens.spacing.lg },
    hero: { gap: tokens.spacing.sm, paddingVertical: tokens.spacing.sm },
    eyebrow: { color: tokens.accent, fontFamily: tokens.fontBody, fontSize: 12, letterSpacing: 1.2 },
    title: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 30 },
    cardTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 21 },
    claimCard: { gap: tokens.spacing.md }, stepCard: { gap: tokens.spacing.md },
    stepNumber: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11, letterSpacing: 1 },
    input: { minHeight: 52, borderWidth: 1, borderColor: tokens.secondary, borderRadius: tokens.radius.md,
      color: tokens.textPrimary, backgroundColor: tokens.surface, fontFamily: tokens.fontBody,
      fontSize: 16, paddingHorizontal: tokens.spacing.lg, paddingVertical: tokens.spacing.md },
    note: { minHeight: 96, textAlignVertical: 'top' },
    responseGroup: { gap: tokens.spacing.sm },
    choices: { flexDirection: 'row', gap: tokens.spacing.sm },
    choice: { minHeight: 48, flex: 1, borderWidth: 1, borderColor: tokens.secondary,
      borderRadius: tokens.radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: tokens.spacing.md },
    choiceSelected: { backgroundColor: tokens.textPrimary, borderColor: tokens.textPrimary },
    choiceText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
    choiceTextSelected: { color: tokens.surfaceElevated, fontWeight: '700' },
    issue: { gap: tokens.spacing.sm, paddingTop: tokens.spacing.sm },
    issueTitle: { color: tokens.danger, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: 14 },
    categoryRow: { gap: tokens.spacing.sm }, actions: { gap: tokens.spacing.md },
    error: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 14, lineHeight: 20 },
    pressed: { opacity: 0.75 },
    missing: { flex: 1, backgroundColor: tokens.surface, justifyContent: 'center',
      padding: tokens.spacing.xl, gap: tokens.spacing.lg },
  });
}
