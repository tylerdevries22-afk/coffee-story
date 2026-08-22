import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { CollapsingScreen } from '@/components/collapsing-screen';
import { groupNotifications, relativeAge, type NotificationItem } from '@/features/notifications/feed';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import { AppIcon } from '@/components/icon';

/**
 * The notifications page, laid out the way Instagram lays its own out: one
 * scroll of time-bucketed rows, each a monogram, a single wrapping sentence
 * that leads with the actor in bold, and an optional trailing action.
 *
 * Grouping and age formatting both come from `features/notifications/feed` so
 * the page stays a pure rendering of data the app already derived.
 */
export function NotificationsScreen({
  items,
  unreadIds,
  onClose,
  onOpen,
  onAction,
}: {
  items: readonly NotificationItem[];
  unreadIds: ReadonlySet<string>;
  onClose: () => void;
  onOpen: (item: NotificationItem) => void;
  onAction: (item: NotificationItem) => void;
}) {
  const now = new Date();
  const sections = groupNotifications(items, now, unreadIds);

  return (
    <CollapsingScreen title="Notifications" onBack={onClose}>
      {sections.length === 0 ? (
        <EmptyFeed />
      ) : (
        sections.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                unread={unreadIds.has(item.id)}
                age={relativeAge(item.at, now)}
                onOpen={onOpen}
                onAction={onAction}
              />
            ))}
          </View>
        ))
      )}
    </CollapsingScreen>
  );
}

function NotificationRow({
  item,
  unread,
  age,
  onOpen,
  onAction,
}: {
  item: NotificationItem;
  unread: boolean;
  age: string;
  onOpen: (item: NotificationItem) => void;
  onAction: (item: NotificationItem) => void;
}) {
  return (
    <View style={[styles.row, unread && styles.rowUnread]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.actor}. ${item.title}. ${item.detail}. ${age} ago`}
        onPress={() => onOpen(item)}
        style={({ pressed }) => [styles.rowBody, pressed && styles.pressed]}
      >
        <Avatar name={item.actor} size={44} />
        <Text style={styles.rowText}>
          <Text style={styles.rowActor}>{item.actor}</Text>
          <Text>{` ${item.title} · ${item.detail}`}</Text>
          <Text style={styles.rowAge}>{`  ${age}`}</Text>
        </Text>
      </Pressable>
      {item.action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.action}: ${item.actor}`}
          onPress={() => onAction(item)}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>{item.action}</Text>
        </Pressable>
      ) : null}
      {unread ? <View accessibilityElementsHidden importantForAccessibility="no" style={styles.unreadDot} /> : null}
    </View>
  );
}

function EmptyFeed() {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyMark}>
        <AppIcon name="bell" size={34} tintColor={colors.brand600} />
      </View>
      <Text style={styles.emptyTitle}>No notifications yet</Text>
      <Text style={styles.emptyBody}>Booking updates and rewards will show up here.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.xs },
  sectionTitle: {
    color: colors.ink900,
    fontFamily: fonts.sansBold,
    fontSize: 15,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  rowUnread: { backgroundColor: colors.brand50 },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowText: {
    flex: 1,
    color: colors.ink700,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
  },
  rowActor: { color: colors.ink900, fontFamily: fonts.sansBold },
  rowAge: { color: colors.ink400 },
  action: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand600,
  },
  actionText: {
    color: colors.white,
    fontFamily: fonts.sansMedium,
    fontSize: 13,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brand500,
  },
  pressed: { opacity: 0.7 },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  emptyMark: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand50,
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    color: colors.ink900,
    fontFamily: fonts.sansBold,
    fontSize: 18,
    lineHeight: 24,
  },
  emptyBody: {
    color: colors.ink500,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
