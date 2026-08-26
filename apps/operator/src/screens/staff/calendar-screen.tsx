import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/icon';
import { CALENDAR_ITEMS, CALENDAR_PEOPLE } from '@/data/calendar-demo';
import { loadLiveCalendarItems } from '@/features/calendar/live';
import { calendarCategoryForItem, calendarDateRail, calendarItemHref, type CalendarItem } from '@/features/calendar/presentation';
import { operatorLayout } from '@/lib/responsive-layout';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';
import { useBusiness } from '@/state/business';
import { useAppTokens, type AppTokens } from '@platform/ui';

type CalendarMode = 'list' | 'day';
type DayKey = string;

export function CalendarScreen() {
  const { styles } = useCalendarTheme();
  const business = useBusiness();
  const { isDemo, tenant } = useAuth();
  const [items, setItems] = useState<readonly CalendarItem[]>(isDemo ? CALENDAR_ITEMS : []);
  const [mode, setMode] = useState<CalendarMode>('list');
  const [day, setDay] = useState<DayKey>('today');
  const [personId, setPersonId] = useState<string>('all');
  const days = useMemo(() => calendarDateRail(new Date(), 7, business.timezone), [business.timezone]);
  useEffect(() => {
    if (isDemo) { setItems(CALENDAR_ITEMS); return undefined; }
    if (!supabase || !tenant) return undefined;
    let mounted = true;
    void loadLiveCalendarItems(supabase, tenant.brand_id).then((loaded) => {
      if (mounted) setItems(loaded);
    }).catch(() => {
      if (mounted) setItems([]);
    });
    return () => { mounted = false; };
  }, [isDemo, tenant]);
  const people = useMemo(() => isDemo ? CALENDAR_PEOPLE : Array.from(
    new Map(items.flatMap((item) => item.assignees).map((person) => [person.id, person])).values(),
  ), [isDemo, items]);
  const visibleItems = useMemo(() => items.filter((item) => (
    item.date === day && (personId === 'all' || item.assignees.some((person) => person.id === personId))
  )), [day, items, personId]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <CalendarHeader businessName={business.name} />
      <DateRail day={day} days={days} onSelect={setDay} />
      <CalendarFilters mode={mode} people={people} personId={personId} onMode={setMode} onPerson={setPersonId} />
      {mode === 'list' ? <CalendarList items={visibleItems} day={day} /> : <DayTimeline items={visibleItems} />}
    </SafeAreaView>
  );
}

function CalendarHeader({ businessName }: { businessName: string }) {
  const { styles } = useCalendarTheme();
  return <View style={styles.header}><View><Text style={styles.title}>Calendar</Text><Text style={styles.subtitle}>{businessName || 'Your workspace'}</Text></View><View style={styles.headerActions}><IconButton label="Filter calendar" icon="slider.horizontal.3" /><IconButton label="Create calendar item" icon="plus" /></View></View>;
}

function DateRail({ day, days, onSelect }: { day: string; days: ReturnType<typeof calendarDateRail>; onSelect: (day: string) => void }) {
  const { styles } = useCalendarTheme();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRail}>{days.map((date) => <Pressable key={date.key} accessibilityRole="button" accessibilityState={{ selected: day === date.key }} accessibilityLabel={`${date.weekday} ${date.day}`} onPress={() => onSelect(date.key)} style={styles.dateButton}><Text style={styles.weekday}>{date.weekday}</Text><View style={[styles.dateCircle, day === date.key && styles.dateCircleSelected]}><Text style={[styles.dateNumber, day === date.key && styles.dateNumberSelected]}>{date.day}</Text></View><View style={[styles.eventDot, day === date.key && styles.eventDotSelected]} /></Pressable>)}</ScrollView>;
}

function CalendarFilters({ mode, people, personId, onMode, onPerson }: { mode: CalendarMode; people: readonly { id: string; name: string; initials: string }[]; personId: string; onMode: (mode: CalendarMode) => void; onPerson: (id: string) => void }) {
  const { colors, styles } = useCalendarTheme();
  return <View style={styles.filterArea}><View style={styles.projectRow}><AppIcon name="briefcase" size={16} tintColor={colors.ink700} /><Text style={styles.projectLabel}>All projects</Text><AppIcon name="chevron.down" size={13} tintColor={colors.ink500} /></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.peopleRail}><PersonBadge label="All" initials="All" selected={personId === 'all'} onPress={() => onPerson('all')} />{people.map((person) => <PersonBadge key={person.id} label={person.name} initials={person.initials} selected={personId === person.id} onPress={() => onPerson(person.id)} />)}</ScrollView><View style={styles.modeSwitch} accessibilityRole="tablist"><ModeButton label="List" selected={mode === 'list'} onPress={() => onMode('list')} /><ModeButton label="Day" selected={mode === 'day'} onPress={() => onMode('day')} /></View></View>;
}

function IconButton({ label, icon }: { label: string; icon: 'plus' | 'slider.horizontal.3' }) {
  const { colors, styles } = useCalendarTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={styles.iconButton}>
      <AppIcon name={icon} size={22} tintColor={colors.ink900} weight="semibold" />
    </Pressable>
  );
}

function PersonBadge({ label, initials, selected, onPress }: { label: string; initials: string; selected: boolean; onPress: () => void }) {
  const { styles } = useCalendarTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Show ${label}`} accessibilityState={{ selected }} onPress={onPress} style={styles.personButton}>
      <View style={[styles.avatar, selected && styles.avatarSelected]}>
        <Text style={[styles.avatarText, selected && styles.avatarTextSelected]}>{initials}</Text>
      </View>
      <Text numberOfLines={1} style={[styles.personName, selected && styles.personNameSelected]}>{label.split(' ')[0]}</Text>
    </Pressable>
  );
}

function ModeButton({ label, selected, onPress }: { label: CalendarMode extends never ? never : string; selected: boolean; onPress: () => void }) {
  const { styles } = useCalendarTheme();
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} onPress={onPress} style={[styles.modeButton, selected && styles.modeButtonSelected]}>
      <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function CalendarList({ items, day }: { items: readonly CalendarItem[]; day: DayKey }) {
  const { styles } = useCalendarTheme();
  const { width, height } = useWindowDimensions();
  const layout = operatorLayout(width, height);
  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={[
        styles.listContent,
        layout.isTablet && { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center' },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.groupTitle}>{day === 'today' ? 'Today' : 'Tomorrow'}</Text>
      {items.length ? items.map((item) => <ScheduleCard key={item.id} item={item} />) : <EmptySchedule />}
    </ScrollView>
  );
}

function ScheduleCard({ item }: { item: CalendarItem }) {
  const { colors, styles } = useCalendarTheme();
  const category = calendarCategoryForItem(item);
  const open = () => router.push(calendarItemHref(item.id) as Href);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${category.label}: ${item.title}, ${item.startTime}`}
      onPress={open}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.categoryRail, { backgroundColor: category.color }]} />
      <View style={styles.cardContent}>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{item.startTime} – {item.endTime}</Text>
          <View style={[styles.categoryBadge, { backgroundColor: category.tint }]}>
            <AppIcon name={category.icon} size={14} tintColor={category.color} />
            <Text style={[styles.categoryText, { color: category.color }]}>{category.label}</Text>
          </View>
        </View>
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.cardMeta}>{item.project} · {item.location}</Text>
        <View style={styles.cardFooter}>
          <View style={styles.avatarStack}>
            {item.assignees.map((person, index) => (
              <View key={person.id} style={[styles.smallAvatar, { marginLeft: index === 0 ? 0 : -6 }]}>
                <Text style={styles.smallAvatarText}>{person.initials}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.status}>{item.status}</Text>
          <AppIcon name="chevron.right" size={15} tintColor={colors.ink400} />
        </View>
      </View>
    </Pressable>
  );
}

function DayTimeline({ items }: { items: readonly CalendarItem[] }) {
  const { colors, styles } = useCalendarTheme();
  const { width, height } = useWindowDimensions();
  const layout = operatorLayout(width, height);
  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={[
        styles.timelineContent,
        layout.isTablet && { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center' },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {['7 AM', '9 AM', '11 AM', '1 PM', '3 PM'].map((time, index) => (
        <View key={time} style={styles.timelineRow}>
          <Text style={styles.timelineTime}>{time}</Text>
          <View style={styles.timelineLine} />
          {items[index] ? <TimelineItem item={items[index]} /> : null}
        </View>
      ))}
      {!items.length ? <EmptySchedule /> : null}
      <Pressable accessibilityRole="button" style={styles.todayButton}>
        <AppIcon name="mappin" size={15} tintColor={colors.ink900} />
        <Text style={styles.todayText}>Today</Text>
      </Pressable>
    </ScrollView>
  );
}

function TimelineItem({ item }: { item: CalendarItem }) {
  const { styles } = useCalendarTheme();
  const category = calendarCategoryForItem(item);
  return (
    <Pressable onPress={() => router.push(calendarItemHref(item.id) as Href)} style={[styles.timelineItem, { borderLeftColor: category.color, backgroundColor: category.tint }]}>
      <AppIcon name={category.icon} size={15} tintColor={category.color} />
      <View style={styles.timelineCopy}><Text style={styles.timelineTitle}>{item.title}</Text><Text style={styles.timelineMeta}>{item.startTime} · {item.assignees.map((person) => person.initials).join(', ')}</Text></View>
    </Pressable>
  );
}

function EmptySchedule() {
  const { colors, styles } = useCalendarTheme();
  return <View style={styles.empty}><AppIcon name="calendar" size={24} tintColor={colors.ink400} /><Text style={styles.emptyTitle}>Nothing scheduled</Text><Text style={styles.emptyText}>Choose another date or person.</Text></View>;
}

function useCalendarTheme() {
  const appTokens = useAppTokens();
  return { colors: appTokens.colors, styles: createStyles(appTokens) };
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
  modeSwitch: { height: 38, flexDirection: 'row', backgroundColor: '#EEEDEB', borderRadius: 9, padding: 3 },
  modeButton: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  modeButtonSelected: { backgroundColor: colors.white },
  modeText: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 13 },
  modeTextSelected: { color: colors.ink900, fontFamily: fonts.sansBold },
  body: { flex: 1 },
  listContent: { padding: spacing.md, paddingBottom: 110, gap: spacing.sm },
  groupTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 20, marginBottom: 2 },
  card: { minHeight: 142, overflow: 'hidden', flexDirection: 'row', backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.ink200 },
  pressed: { opacity: 0.72 },
  categoryRail: { width: 5 },
  cardContent: { flex: 1, padding: spacing.md, gap: 7 },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  time: { color: colors.ink600, fontFamily: fonts.sansBold, fontSize: 12 },
  categoryBadge: { minHeight: 27, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9 },
  categoryText: { fontFamily: fonts.sansBold, fontSize: 10 },
  cardTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18, letterSpacing: -0.2 },
  cardMeta: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13 },
  cardFooter: { marginTop: 'auto', minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarStack: { flexDirection: 'row' },
  smallAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brand100, borderWidth: 2, borderColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  smallAvatarText: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 8 },
  status: { flex: 1, color: colors.ink600, fontFamily: fonts.sansMedium, fontSize: 12 },
  timelineContent: { padding: spacing.md, paddingBottom: 120 },
  timelineRow: { minHeight: 92, flexDirection: 'row', alignItems: 'flex-start', position: 'relative' },
  timelineTime: { width: 48, color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 10, textAlign: 'right', paddingRight: 9, marginTop: -6 },
  timelineLine: { position: 'absolute', left: 48, right: 0, top: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.ink300 },
  timelineItem: { flex: 1, minHeight: 68, borderLeftWidth: 4, borderRadius: 8, marginLeft: 8, marginTop: 7, padding: spacing.sm, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  timelineCopy: { flex: 1, gap: 3 },
  timelineTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 13 },
  timelineMeta: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 10 },
  todayButton: { alignSelf: 'center', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, backgroundColor: colors.white, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.ink200 },
  todayText: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 12 },
  empty: { minHeight: 170, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', gap: 6, padding: spacing.lg },
  emptyTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  emptyText: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13 },
  });
}
