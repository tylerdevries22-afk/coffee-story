import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { operationDisplayStatus, type OperationDisplayStatus } from '@platform/domain';
import { useTokens, type BrandTokens } from '@platform/ui';

import { Body, Card, SectionTitle } from '@/components/ui';
import { useOperations } from '@/state/operations-store';

const STATUS_LABEL: Readonly<Record<OperationDisplayStatus, string>> = {
  scheduled: 'Scheduled', claimed: 'In progress', completed: 'Complete',
  overdue: 'Overdue', missed: 'Missed', cancelled: 'Cancelled',
};

function clockTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function openOccurrence(occurrenceId: string): void {
  router.push(`/staff/crew/${encodeURIComponent(occurrenceId)}` as Href);
}

export function OperationQueue() {
  const tokens = useTokens();
  const styles = createStyles(tokens);
  const operations = useOperations();
  if (!operations.enabled) return null;
  const active = operations.occurrences.filter((item) => !['completed', 'missed', 'cancelled'].includes(item.status));

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <SectionTitle>Shift operations</SectionTitle>
        {operations.pendingCount > 0 ? <Text style={styles.sync}>{operations.pendingCount} syncing</Text> : null}
      </View>
      {operations.error ? <Text accessibilityRole="alert" style={styles.error}>{operations.error}</Text> : null}
      {operations.conflicts.map((conflict) => (
        <Pressable accessibilityRole="button" key={conflict.actionId}
          onPress={() => void operations.discardConflict(conflict.actionId)} style={styles.conflict}>
          <Text accessibilityRole="alert" style={styles.error}>{conflict.message}</Text>
          <Text style={styles.dismiss}>Dismiss and refresh</Text>
        </Pressable>
      ))}
      {operations.loading && active.length === 0 ? <Body muted>Refreshing location tasks…</Body> : null}
      {!operations.loading && active.length === 0 ? <Body muted>No active operations for this location.</Body> : null}
      {active.map((task) => {
        const displayStatus = operationDisplayStatus(task, operations.now);
        return (
        <Pressable
          accessibilityHint="Opens the checklist and task controls"
          accessibilityLabel={`${task.snapshot.title}, ${STATUS_LABEL[displayStatus]}`}
          accessibilityRole="button"
          key={task.id}
          onPress={() => openOccurrence(task.id)}
          style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
        >
          <Card style={styles.card}>
            <View style={styles.copy}>
              <Text style={styles.title}>{task.snapshot.title}</Text>
              <Body muted>{clockTime(task.scheduledFor)} · {task.snapshot.estimatedMinutes} min</Body>
            </View>
            <View style={[styles.status, displayStatus === 'overdue' && styles.overdue,
              displayStatus === 'claimed' && styles.claimed]}>
              <Text style={[styles.statusText, displayStatus === 'overdue' && styles.overdueText]}>
                {STATUS_LABEL[displayStatus]}
              </Text>
            </View>
          </Card>
        </Pressable>
      ); })}
    </View>
  );
}

function createStyles(tokens: BrandTokens) {
  return StyleSheet.create({
    section: { marginTop: tokens.spacing.md },
    heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sync: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
    error: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 19,
      marginBottom: tokens.spacing.sm },
    conflict: { minHeight: 48, marginBottom: tokens.spacing.sm },
    dismiss: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 12,
      textDecorationLine: 'underline' },
    pressable: { marginBottom: tokens.spacing.md },
    pressed: { opacity: 0.78 },
    card: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md },
    copy: { flex: 1, gap: 3 },
    title: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 20 },
    status: { borderRadius: tokens.radius.pill, backgroundColor: tokens.secondary,
      paddingHorizontal: tokens.spacing.md, paddingVertical: 8 },
    claimed: { backgroundColor: tokens.surfaceElevated },
    overdue: { backgroundColor: tokens.danger },
    statusText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 12 },
    overdueText: { color: tokens.surfaceElevated },
  });
}
