/**
 * The two schedule bodies (list and day-timeline): split out of
 * calendar-screen.tsx so that file stays under the line cap once it grew a
 * third render state (loading/error, not just items/empty).
 */
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { calendarCategoryForItem, calendarItemHref, type CalendarItem } from '@/features/calendar/presentation';
import { operatorLayout } from '@/lib/responsive-layout';
import { AppIcon } from '@platform/ui';

import { EmptySchedule, ErrorSchedule, LoadingSchedule, TimelineItem } from './calendar-items';
import { scheduleDisplay, type CalendarLoadState } from './calendar-load-state';
import { useCalendarTheme } from './calendar-theme';

export function CalendarList({ items, day, state, onRetry }: {
  items: readonly CalendarItem[]; day: string; state: CalendarLoadState; onRetry: () => void;
}) {
  const { styles } = useCalendarTheme();
  const { width, height } = useWindowDimensions();
  const layout = operatorLayout(width, height);
  const display = scheduleDisplay(state, items.length);
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
      {display === 'items' ? items.map((item) => <ScheduleCard key={item.id} item={item} />) : null}
      {display === 'loading' ? <LoadingSchedule /> : null}
      {display === 'error' && state.status === 'error' ? <ErrorSchedule message={state.message} onRetry={onRetry} /> : null}
      {display === 'empty' ? <EmptySchedule /> : null}
    </ScrollView>
  );
}

function ScheduleCard({ item }: { item: CalendarItem }) {
  const { colors, tokens, styles } = useCalendarTheme();
  const category = calendarCategoryForItem(item, tokens);
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

export function DayTimeline({ items, state, onRetry }: {
  items: readonly CalendarItem[]; state: CalendarLoadState; onRetry: () => void;
}) {
  const { colors, styles } = useCalendarTheme();
  const { width, height } = useWindowDimensions();
  const layout = operatorLayout(width, height);
  const display = scheduleDisplay(state, items.length);
  const showSlots = display === 'items' || display === 'empty';
  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={[
        styles.timelineContent,
        layout.isTablet && { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center' },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {showSlots ? ['7 AM', '9 AM', '11 AM', '1 PM', '3 PM'].map((time, index) => (
        <View key={time} style={styles.timelineRow}>
          <Text style={styles.timelineTime}>{time}</Text>
          <View style={styles.timelineLine} />
          {items[index] ? <TimelineItem item={items[index]} /> : null}
        </View>
      )) : null}
      {display === 'loading' ? <LoadingSchedule /> : null}
      {display === 'error' && state.status === 'error' ? <ErrorSchedule message={state.message} onRetry={onRetry} /> : null}
      {display === 'empty' ? <EmptySchedule /> : null}
      <Pressable accessibilityRole="button" style={styles.todayButton}>
        <AppIcon name="mappin" size={15} tintColor={colors.ink900} />
        <Text style={styles.todayText}>Today</Text>
      </Pressable>
    </ScrollView>
  );
}
