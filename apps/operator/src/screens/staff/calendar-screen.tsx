import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEMO_OPERATOR_FIXTURES } from '@/data/demo-fixtures';
import { loadLiveCalendarItems } from '@/features/calendar/live';
import { calendarDateRail } from '@/features/calendar/presentation';
import { operationCalendarItems } from '@/features/operations/calendar';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/state/auth-context';
import { useBusiness } from '@/state/business';
import { useOperations } from '@/state/operations-store';
import { useOperator } from '@/state/operator-store';
import { AppIcon, tabState, toggleState } from '@platform/ui';

import { CalendarList, DayTimeline } from './calendar-schedule-views';
import {
  calendarLoadFailed,
  calendarLoaded,
  calendarLoading,
  type CalendarLoadState,
} from './calendar-load-state';
import { useCalendarTheme } from './calendar-theme';

type CalendarMode = 'list' | 'day';
type DayKey = string;

export function CalendarScreen() {
  const { styles } = useCalendarTheme();
  const business = useBusiness();
  const { isDemo, tenant } = useAuth();
  const operations = useOperations();
  const { location } = useOperator();
  const [calendarState, setCalendarState] = useState<CalendarLoadState>(
    () => (isDemo ? calendarLoaded(DEMO_OPERATOR_FIXTURES.calendarItems) : calendarLoading()),
  );
  const [mode, setMode] = useState<CalendarMode>('list');
  const [day, setDay] = useState<DayKey>('today');
  const [personId, setPersonId] = useState<string>('all');
  const [reloadToken, setReloadToken] = useState(0);
  const days = useMemo(() => calendarDateRail(new Date(), 7, business.timezone), [business.timezone]);
  useEffect(() => {
    if (isDemo) { setCalendarState(calendarLoaded(DEMO_OPERATOR_FIXTURES.calendarItems)); return undefined; }
    if (!supabase || !tenant) return undefined;
    let mounted = true;
    setCalendarState(calendarLoading());
    void loadLiveCalendarItems(supabase, tenant.brand_id).then((loaded) => {
      if (mounted) setCalendarState(calendarLoaded(loaded));
    }).catch((error: unknown) => {
      if (mounted) setCalendarState(calendarLoadFailed(error));
    });
    return () => { mounted = false; };
  }, [isDemo, tenant, reloadToken]);
  const retry = useCallback(() => setReloadToken((token) => token + 1), []);
  const items = useMemo(() => {
    const baseItems = calendarState.status === 'loaded' ? calendarState.items : [];
    return [
      ...baseItems,
      ...operationCalendarItems(operations.occurrences, location.name, location.timezone, operations.now),
    ].sort((left, right) => Date.parse(left.startsAt ?? '') - Date.parse(right.startsAt ?? ''));
  }, [calendarState, location.name, location.timezone, operations.now, operations.occurrences]);
  const people = useMemo(() => isDemo ? DEMO_OPERATOR_FIXTURES.calendarPeople : Array.from(
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
      {mode === 'list'
        ? <CalendarList items={visibleItems} day={day} state={calendarState} onRetry={retry} />
        : <DayTimeline items={visibleItems} state={calendarState} onRetry={retry} />}
    </SafeAreaView>
  );
}

function CalendarHeader({ businessName }: { businessName: string }) {
  const { styles } = useCalendarTheme();
  return <View style={styles.header}><View><Text style={styles.title}>Calendar</Text><Text style={styles.subtitle}>{businessName || 'Your workspace'}</Text></View><View style={styles.headerActions}><IconButton label="Filter calendar" icon="slider.horizontal.3" /><IconButton label="Create calendar item" icon="plus" /></View></View>;
}

function DateRail({ day, days, onSelect }: { day: string; days: ReturnType<typeof calendarDateRail>; onSelect: (day: string) => void }) {
  const { styles } = useCalendarTheme();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRail}>{days.map((date) => <Pressable key={date.key} accessibilityRole="button" {...toggleState(day === date.key)} accessibilityLabel={`${date.weekday} ${date.day}`} onPress={() => onSelect(date.key)} style={styles.dateButton}><Text style={styles.weekday}>{date.weekday}</Text><View style={[styles.dateCircle, day === date.key && styles.dateCircleSelected]}><Text style={[styles.dateNumber, day === date.key && styles.dateNumberSelected]}>{date.day}</Text></View><View style={[styles.eventDot, day === date.key && styles.eventDotSelected]} /></Pressable>)}</ScrollView>;
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
    <Pressable accessibilityRole="button" accessibilityLabel={`Show ${label}`} {...toggleState(selected)} onPress={onPress} style={styles.personButton}>
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
    <Pressable accessibilityRole="tab" {...tabState(selected)} onPress={onPress} style={[styles.modeButton, selected && styles.modeButtonSelected]}>
      <Text style={[styles.modeText, selected && styles.modeTextSelected]}>{label}</Text>
    </Pressable>
  );
}
