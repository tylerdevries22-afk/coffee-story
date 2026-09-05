import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEMO_OPERATOR_FIXTURES } from '@/data/demo-fixtures';
import { loadLiveCalendarItems } from '@/features/calendar/live';
import { calendarCategoryForItem, calendarItemById, calendarProgressLabels, type CalendarItem } from '@/features/calendar/presentation';
import { operationCalendarItems } from '@/features/operations/calendar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';
import { useOperations } from '@/state/operations-store';
import { useOperator } from '@/state/operator-store';
import { useAppTokens, useTokens as useBrandTokens, type AppTokens, AppIcon } from '@platform/ui';

export function CalendarDetailScreen({ itemId }: { itemId: string }) {
  const { isDemo, tenant } = useAuth();
  const operations = useOperations();
  const { location } = useOperator();
  const projectedOperation = useMemo(() => calendarItemById(operationCalendarItems(
    operations.occurrences, location.name, location.timezone, operations.now,
  ), itemId), [itemId, location.name, location.timezone, operations.now, operations.occurrences]);
  const [item, setItem] = useState<CalendarItem | null>(() => (
    projectedOperation ?? (isDemo ? calendarItemById(DEMO_OPERATOR_FIXTURES.calendarItems, itemId) : null)
  ));
  const [loaded, setLoaded] = useState(isDemo);
  useEffect(() => {
    if (projectedOperation) { setItem(projectedOperation); setLoaded(true); return undefined; }
    if (isDemo) { setItem(calendarItemById(DEMO_OPERATOR_FIXTURES.calendarItems, itemId)); setLoaded(true); return undefined; }
    if (!supabase || !tenant) { setLoaded(true); return undefined; }
    let mounted = true;
    void loadLiveCalendarItems(supabase, tenant.brand_id).then((items) => {
      if (mounted) setItem(calendarItemById(items, itemId));
    }).catch(() => {
      if (mounted) setItem(null);
    }).finally(() => {
      if (mounted) setLoaded(true);
    });
    return () => { mounted = false; };
  }, [isDemo, itemId, projectedOperation, tenant]);
  if (!loaded) return <CalendarLoading />;
  if (!item) return <MissingCalendarItem />;
  return <CalendarItemDetailShell item={item} />;
}

function CalendarItemDetailShell({ item }: { item: CalendarItem }) {
  const { tokens, styles } = useCalendarDetailTheme();
  const category = calendarCategoryForItem(item, tokens);
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <DetailHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <DetailHero item={item} />
        <ProgressCard item={item} />
        <SummaryCard item={item} />
        {item.assignees.length > 0 ? <PeopleCard item={item} /> : null}
        <ItemSections item={item} />
        <ActivityCard color={category.color} />
      </ScrollView>
      <DetailAction label={item.primaryAction} occurrenceId={item.operationOccurrenceId} />
    </SafeAreaView>
  );
}

function DetailHeader() {
  const { colors, styles } = useCalendarDetailTheme();
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back to calendar" hitSlop={8} onPress={() => router.back()} style={styles.backButton}><AppIcon name="chevron.left" size={22} tintColor={colors.ink900} weight="semibold" /></Pressable><Text style={styles.headerTitle}>Calendar</Text><Pressable accessibilityRole="button" accessibilityLabel="More actions" hitSlop={8} style={styles.backButton}><AppIcon name="ellipsis" size={22} tintColor={colors.ink900} weight="semibold" /></Pressable></View>;
}
function DetailHero({ item }: { item: CalendarItem }) {
  const { tokens, styles } = useCalendarDetailTheme();
  const category = calendarCategoryForItem(item, tokens);
  return <View style={styles.hero}><View style={[styles.categoryIcon, { backgroundColor: category.tint }]}><AppIcon name={category.icon} size={26} tintColor={category.color} weight="semibold" /></View><View style={styles.heroCopy}><Text style={[styles.category, { color: category.color }]}>{category.label.toUpperCase()}</Text><Text style={styles.title}>{item.title}</Text><Text style={styles.summary}>{item.summary}</Text></View></View>;
}
function CalendarLoading() {
  const { colors, styles } = useCalendarDetailTheme();
  return <SafeAreaView style={styles.missing}><AppIcon name="calendar" size={30} tintColor={colors.ink400} /><Text style={styles.summary}>Loading calendar item…</Text></SafeAreaView>;
}
function ProgressCard({ item }: { item: CalendarItem }) {
  const { styles } = useCalendarDetailTheme();
  const [start, current, finish] = calendarProgressLabels(item);
  return <View style={styles.progressCard}><ProgressStep label={start} complete /><View style={styles.progressLine} /><ProgressStep label={current} active /><View style={styles.progressLine} /><ProgressStep label={finish} /></View>;
}
function SummaryCard({ item }: { item: CalendarItem }) {
  const { styles } = useCalendarDetailTheme();
  const date = item.date === 'today' ? 'Today' : item.date === 'tomorrow' ? 'Tomorrow' : 'Upcoming';
  return <View style={styles.summaryCard}><DetailRow icon="calendar" label="Date" value={date} /><DetailRow icon="clock" label="Time" value={`${item.startTime} – ${item.endTime}`} /><DetailRow icon="mappin" label="Location" value={item.location} /><DetailRow icon="briefcase" label="Project" value={item.project} last /></View>;
}

function PeopleCard({ item }: { item: CalendarItem }) {
  const { styles } = useCalendarDetailTheme();
  return <View style={styles.sectionCard}><Text style={styles.sectionTitle}>Assigned people</Text><View style={styles.people}>{item.assignees.map((person) => <View key={person.id} style={styles.person}><View style={styles.avatar}><Text style={styles.avatarText}>{person.initials}</Text></View><Text style={styles.personName}>{person.name}</Text></View>)}</View></View>;
}

function ItemSections({ item }: { item: CalendarItem }) {
  const { styles } = useCalendarDetailTheme();
  return <>{item.sections.map((section) => <View key={section.title} style={styles.sectionCard}><Text style={styles.sectionTitle}>{section.title}</Text>{section.rows.map((row, index) => <View key={row.label} style={[styles.textRow, index === section.rows.length - 1 && styles.lastRow]}><Text style={styles.rowLabel}>{row.label}</Text><Text style={styles.rowValue}>{row.value}</Text></View>)}</View>)}</>;
}

function ActivityCard({ color }: { color: string }) {
  const { styles } = useCalendarDetailTheme();
  return <View style={styles.sectionCard}><Text style={styles.sectionTitle}>Activity</Text><View style={styles.activity}><View style={[styles.activityDot, { backgroundColor: color }]} /><View style={styles.activityCopy}><Text style={styles.activityTitle}>Item scheduled</Text><Text style={styles.activityMeta}>Visible to assigned people</Text></View></View></View>;
}

function DetailAction({ label, occurrenceId }: { label: string; occurrenceId?: string }) {
  const { colors, styles } = useCalendarDetailTheme();
  const open = occurrenceId
    ? () => router.push(`/staff/crew/${encodeURIComponent(occurrenceId)}` as Href)
    : undefined;
  return <View style={styles.actionBar}><Pressable accessibilityRole="button" disabled={!open}
    onPress={open} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}><Text style={styles.primaryActionText}>{label}</Text><AppIcon name="chevron.right" size={17} tintColor={colors.white} weight="semibold" /></Pressable></View>;
}

function ProgressStep({ label, complete = false, active = false }: { label: string; complete?: boolean; active?: boolean }) {
  const { colors, styles } = useCalendarDetailTheme();
  return (
    <View style={styles.progressStep}>
      <View style={[styles.progressDot, (complete || active) && styles.progressDotActive]}>
        {complete ? <AppIcon name="checkmark" size={12} tintColor={colors.white} weight="semibold" /> : null}
      </View>
      <Text numberOfLines={1} style={[styles.progressText, active && styles.progressTextActive]}>{label}</Text>
    </View>
  );
}

function DetailRow({ icon, label, value, last = false }: { icon: 'calendar' | 'clock' | 'mappin' | 'briefcase'; label: string; value: string; last?: boolean }) {
  const { colors, styles } = useCalendarDetailTheme();
  return (
    <View style={[styles.detailRow, last && styles.lastRow]}>
      <View style={styles.detailIcon}><AppIcon name={icon} size={17} tintColor={colors.ink600} /></View>
      <View style={styles.detailCopy}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View>
    </View>
  );
}

function MissingCalendarItem() {
  const { colors, styles } = useCalendarDetailTheme();
  return (
    <SafeAreaView style={styles.missing}>
      <AppIcon name="calendar" size={30} tintColor={colors.ink400} />
      <Text style={styles.title}>Calendar item unavailable</Text>
      <Text style={styles.summary}>It may have been removed or you may not have access.</Text>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondaryAction}><Text style={styles.secondaryActionText}>Back to calendar</Text></Pressable>
    </SafeAreaView>
  );
}

function useCalendarDetailTheme() {
  const appTokens = useAppTokens();
  return { colors: appTokens.colors, tokens: useBrandTokens(), styles: createStyles(appTokens) };
}

function createStyles({ colors, fonts, radius, spacing }: AppTokens) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.warm },
  header: { minHeight: 58, backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ink200, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  headerTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 17 },
  content: { padding: spacing.md, paddingBottom: 116, gap: spacing.sm },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  categoryIcon: { width: 54, height: 54, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1, gap: 5 },
  category: { fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.8 },
  title: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 24, letterSpacing: -0.5 },
  summary: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20 },
  progressCard: { minHeight: 82, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.ink200, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md },
  progressStep: { width: 70, alignItems: 'center', gap: 6 },
  progressDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.ink300, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  progressDotActive: { borderColor: colors.brand700, backgroundColor: colors.brand700 },
  progressText: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 9 },
  progressTextActive: { color: colors.ink900, fontFamily: fonts.sansBold },
  progressLine: { flex: 1, height: 2, backgroundColor: colors.ink200, marginTop: -15 },
  summaryCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.ink200, overflow: 'hidden' },
  detailRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ink200 },
  detailIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: colors.brand50, alignItems: 'center', justifyContent: 'center' },
  detailCopy: { flex: 1, gap: 2 },
  rowLabel: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 11 },
  detailValue: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  lastRow: { borderBottomWidth: 0 },
  sectionCard: { backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.ink200, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  sectionTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 17, marginBottom: spacing.sm },
  people: { paddingBottom: spacing.md, gap: spacing.sm },
  person: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brand100, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 10 },
  personName: { color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 14 },
  textRow: { minHeight: 55, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ink200 },
  rowValue: { flex: 1, color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 13, textAlign: 'right' },
  activity: { minHeight: 58, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingBottom: spacing.md },
  activityDot: { width: 9, height: 9, borderRadius: 5, marginTop: 5 },
  activityCopy: { flex: 1, gap: 3 },
  activityTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 13 },
  activityMeta: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.white, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.ink200 },
  primaryAction: { minHeight: 52, borderRadius: 8, paddingHorizontal: spacing.md, backgroundColor: colors.ink900, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  primaryActionText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 15 },
  pressed: { opacity: 0.78 },
  missing: { flex: 1, backgroundColor: colors.warm, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  secondaryAction: { minHeight: 48, paddingHorizontal: spacing.lg, marginTop: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.ink300, alignItems: 'center', justifyContent: 'center' },
  secondaryActionText: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  });
}
