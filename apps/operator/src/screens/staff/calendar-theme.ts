import { StyleSheet } from 'react-native';

import { useAppTokens, useTokens as useBrandTokens, type AppTokens } from '@platform/ui';

export function useCalendarTheme() {
  const appTokens = useAppTokens();
  return { colors: appTokens.colors, tokens: useBrandTokens(), styles: createStyles(appTokens) };
}

function createStyles({ colors, fonts, radius, spacing }: AppTokens) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.warm },
    header: { minHeight: 74, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ink200 },
    title: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 25, letterSpacing: -0.5 },
    subtitle: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12, marginTop: 2 },
    headerActions: { flexDirection: 'row', gap: 4 },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    dateRail: { minWidth: '100%', paddingHorizontal: spacing.md, backgroundColor: colors.white, justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.sm },
    dateButton: { minWidth: 52, minHeight: 70, alignItems: 'center', justifyContent: 'center' },
    weekday: { color: colors.ink500, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.7 },
    dateCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
    dateCircleSelected: { backgroundColor: colors.ink900 },
    dateNumber: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
    dateNumberSelected: { color: colors.white },
    eventDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.ink300, marginTop: 3 },
    eventDotSelected: { backgroundColor: colors.brand500 },
    filterArea: { backgroundColor: colors.white, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ink200 },
    projectRow: { alignSelf: 'flex-start', minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7 },
    projectLabel: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
    peopleRail: { gap: spacing.sm, paddingBottom: spacing.sm },
    personButton: { width: 52, alignItems: 'center', gap: 3 },
    avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brand100, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
    avatarSelected: { borderColor: colors.brand700, backgroundColor: colors.white },
    avatarText: { color: colors.ink600, fontFamily: fonts.sansBold, fontSize: 10 },
    avatarTextSelected: { color: colors.brand700 },
    personName: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 9 },
    personNameSelected: { color: colors.ink900 },
    modeSwitch: { height: 38, flexDirection: 'row', backgroundColor: colors.brand100, borderRadius: 9, padding: 3 },
    modeButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
    modeButtonSelected: { backgroundColor: colors.white },
    modeText: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 13 },
    modeTextSelected: { color: colors.ink900, fontFamily: fonts.sansBold },
    body: { flex: 1 }, listContent: { padding: spacing.md, paddingBottom: 110, gap: spacing.sm },
    groupTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 20, marginBottom: 2 },
    card: { minHeight: 142, overflow: 'hidden', flexDirection: 'row', backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.ink200 },
    pressed: { opacity: 0.72 }, categoryRail: { width: 5 },
    cardContent: { flex: 1, padding: spacing.md, gap: 7 },
    timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    time: { color: colors.ink600, fontFamily: fonts.sansBold, fontSize: 12 },
    categoryBadge: { minHeight: 27, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9 },
    categoryText: { fontFamily: fonts.sansBold, fontSize: 10 }, cardTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18, letterSpacing: -0.2 },
    cardMeta: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13 },
    cardFooter: { marginTop: 'auto', minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    avatarStack: { flexDirection: 'row' }, smallAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brand100, borderWidth: 2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
    smallAvatarText: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 8 }, status: { flex: 1, color: colors.ink600, fontFamily: fonts.sansMedium, fontSize: 12 },
    timelineContent: { padding: spacing.md, paddingBottom: 120 }, timelineRow: { minHeight: 92, flexDirection: 'row', alignItems: 'flex-start', position: 'relative' },
    timelineTime: { width: 48, color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 10, textAlign: 'right', paddingRight: 9, marginTop: -6 },
    timelineLine: { position: 'absolute', left: 48, right: 0, top: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.ink300 },
    timelineItem: { flex: 1, minHeight: 68, borderLeftWidth: 4, borderRadius: 8, marginLeft: 8, marginTop: 7, padding: spacing.sm, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    timelineCopy: { flex: 1, gap: 3 }, timelineTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 13 }, timelineMeta: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 10 },
    todayButton: { alignSelf: 'center', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, backgroundColor: colors.white, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.ink200 },
    todayText: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 12 }, empty: { minHeight: 170, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', gap: 6, padding: spacing.lg },
    emptyTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 }, emptyText: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13 },
  });
}
