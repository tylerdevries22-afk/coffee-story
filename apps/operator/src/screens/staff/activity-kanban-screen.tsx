import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo, Animated, Pressable, ScrollView, Text, View, useWindowDimensions,
} from 'react-native';
import { router, type Href } from 'expo-router';

import { activityInitials, type ActivityBoardConfig } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { activityAudience, activityLanes } from '@/features/operations/activity-kanban';
import type { OperatorTaskOccurrence } from '@/features/operations/model';
import { useOperations } from '@/state/operations-store';
import { activityKanbanStyles } from './activity-kanban-styles';

function TaskCard({ task, index, showAvatar }: {
  task: OperatorTaskOccurrence; index: number; showAvatar: boolean;
}) {
  const tokens = useTokens();
  const styles = activityKanbanStyles(tokens);
  const [motion] = useState(() => new Animated.Value(0));
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (reduceMotion) {
      motion.setValue(1);
      return;
    }
    const animation = Animated.timing(motion, {
      toValue: 1, duration: tokens.motion.base, delay: Math.min(index * 45, 270),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [index, motion, reduceMotion, tokens.motion.base]);
  const actor = task.actorName ?? (task.status === 'scheduled' ? 'Unassigned' : 'Field team');
  const open = () => router.push(`/staff/crew/${encodeURIComponent(task.id)}` as Href);
  return (
    <Animated.View style={{ opacity: motion, transform: [{ translateY: motion.interpolate({
      inputRange: [0, 1], outputRange: [10, 0],
    }) }] }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${task.snapshot.title}, ${activityAudience(task)}`}
        onPress={open} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <Text style={styles.audience}>{activityAudience(task)}</Text>
        <Text style={styles.title}>{task.snapshot.title}</Text>
        <View style={styles.meta}>
          <Text style={styles.time}>{task.snapshot.estimatedMinutes} min</Text>
          <View style={styles.actor}>
            {showAvatar ? <View style={styles.avatar}><Text style={styles.avatarText}>{activityInitials(actor)}</Text></View> : null}
            <Text numberOfLines={1} style={styles.actorName}>{actor}</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function ActivityKanbanScreen({ config }: { config: ActivityBoardConfig }) {
  const tokens = useTokens();
  const styles = activityKanbanStyles(tokens);
  const { width } = useWindowDimensions();
  const operations = useOperations();
  const lanes = useMemo(() => activityLanes(operations.occurrences), [operations.occurrences]);
  const wide = width >= 900;
  const laneWidth = wide ? Math.max(260, (Math.min(width, 1180) - 76) / 3) : Math.max(280, width - 48);
  return (
    <CollapsingScreen title={config.title} eyebrow="GC · contractors · admin">
      <View style={styles.summary}>
        <View style={styles.liveDot} />
        <Text style={styles.summaryText}>{operations.pendingCount > 0
          ? `${operations.pendingCount} updates syncing` : 'Live project operations'}</Text>
      </View>
      {operations.error ? <Text accessibilityRole="alert" style={styles.error}>{operations.error}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.board, styles.boardWide]}>
        {lanes.map((lane) => (
          <View key={lane.key} style={[styles.lane, { width: laneWidth }]}>
            <View style={styles.laneHeader}>
              <Text style={styles.laneTitle}>{lane.label}</Text>
              <Text style={styles.count}>{lane.tasks.length}</Text>
            </View>
            {lane.tasks.length === 0 ? <Text style={styles.empty}>No tasks</Text> : null}
            {lane.tasks.map((task, index) => (
              <TaskCard key={task.id} task={task} index={index} showAvatar={config.showAvatars} />
            ))}
          </View>
        ))}
      </ScrollView>
    </CollapsingScreen>
  );
}
