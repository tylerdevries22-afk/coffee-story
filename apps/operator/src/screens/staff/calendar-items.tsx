import { router, type Href } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { calendarCategoryForItem, calendarItemHref, type CalendarItem } from '@/features/calendar/presentation';
import { AppIcon } from '@platform/ui';

import { useCalendarTheme } from './calendar-theme';

export function TimelineItem({ item }: { item: CalendarItem }) {
  const { tokens, styles } = useCalendarTheme();
  const category = calendarCategoryForItem(item, tokens);
  return (
    <Pressable onPress={() => router.push(calendarItemHref(item.id) as Href)} style={[styles.timelineItem, { borderLeftColor: category.color, backgroundColor: category.tint }]}>
      <AppIcon name={category.icon} size={15} tintColor={category.color} />
      <View style={styles.timelineCopy}><Text style={styles.timelineTitle}>{item.title}</Text><Text style={styles.timelineMeta}>{item.startTime} · {item.assignees.map((person) => person.initials).join(', ')}</Text></View>
    </Pressable>
  );
}

export function EmptySchedule() {
  const { colors, styles } = useCalendarTheme();
  return <View style={styles.empty}><AppIcon name="calendar" size={24} tintColor={colors.ink400} /><Text style={styles.emptyTitle}>Nothing scheduled</Text><Text style={styles.emptyText}>Choose another date or person.</Text></View>;
}
