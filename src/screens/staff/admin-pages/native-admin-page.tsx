import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, PillRow, SectionTitle } from '@/components/ui';
import { NATIVE_ADMIN_PAGES } from '@/features/admin/admin-pages/content';
import { workspaceTone } from '@/features/staff/workspace';
import { useAuth } from '@/state/auth-context';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

export function Metric({ label, value }: { label: string; value: string }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

export function NativeAdminPage({
  path,
  isDemo,
  onBack,
}: {
  path: string;
  isDemo: boolean;
  onBack: () => void;
}) {
  const config = NATIVE_ADMIN_PAGES[path];
  const { role } = useAuth();
  const tone = workspaceTone(role);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [notes, setNotes] = useState('');
  if (!config) {
    return (
      <CollapsingScreen title="Page unavailable" onBack={onBack} tone={tone}>
        <Body muted>This native demo destination has not been configured.</Body>
      </CollapsingScreen>
    );
  }
  if (!isDemo) {
    return (
      <CollapsingScreen title={config.title} eyebrow={config.eyebrow} onBack={onBack} tone={tone}>
        <Body muted>{config.summary}</Body>
        <Card style={styles.detailCard}>
          <Text style={styles.detailHeading}>Live connection required</Text>
          <Body>
            This destination is available in the demo. Live metrics and actions stay
            disabled until its provider credentials and Supabase migration are connected.
          </Body>
        </Card>
      </CollapsingScreen>
    );
  }
  return (
    <CollapsingScreen title={config.title} eyebrow={config.eyebrow} onBack={onBack} tone={tone}>
      <Body muted>{config.summary}</Body>
      <View style={styles.metrics}>
        {config.metrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} />)}
      </View>
      <SectionTitle>Overview</SectionTitle>
      {config.rows.map((row) => (
        <PillRow
          key={row.title}
          title={row.title}
          subtitle={row.subtitle}
          onPress={() => {
            setSelectedRow(row.title);
            setNotice(null);
          }}
        />
      ))}
      {selectedRow ? (
        <Card style={styles.detailCard}>
          <Text style={styles.detailHeading}>{selectedRow}</Text>
          <Body>{config.rows.find((row) => row.title === selectedRow)?.subtitle ?? 'Record details are available.'}</Body>
          <Button label={config.action} variant="secondary" onPress={() => setWorkflowOpen(true)} />
        </Card>
      ) : null}
      {workflowOpen ? (
        <Card style={styles.workflowCard}>
          <Text style={styles.detailHeading}>{config.action}</Text>
          <Body muted>This Demo workflow is saved only for the current preview.</Body>
          <TextInput
            accessibilityLabel={`${config.action} notes`}
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Add optional notes"
            placeholderTextColor={colors.ink400}
            style={styles.workflowInput}
          />
          <Button
            label={`Complete ${config.action.toLowerCase()}`}
            onPress={() => {
              setWorkflowOpen(false);
              setNotice(`${config.action} completed in Demo mode${notes.trim() ? ' with your notes' : ''}.`);
              setNotes('');
            }}
          />
          <Button label="Cancel" variant="secondary" onPress={() => setWorkflowOpen(false)} />
        </Card>
      ) : null}
      {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
      {!workflowOpen ? <Button label={config.action} onPress={() => setWorkflowOpen(true)} /> : null}
    </CollapsingScreen>
  );
}

export const styles = StyleSheet.create({
  shell: { flex: 1 },
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, minHeight: 92, borderRadius: radius.md, backgroundColor: colors.brand50, alignItems: 'center', justifyContent: 'center' },
  metricValue: { color: colors.ink900, fontFamily: fonts.display, fontSize: 28 },
  metricLabel: { color: colors.ink500, fontFamily: fonts.sansMedium, fontSize: 11 },
  nextCard: { backgroundColor: colors.brand700, gap: spacing.sm },
  nextTime: { color: colors.brand200, fontFamily: fonts.sansBold, fontSize: 13 },
  nextName: { color: colors.white, fontFamily: fonts.display, fontSize: 28 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionButton: { flex: 1, minHeight: 46 },
  scheduleRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.ink200 },
  scheduleTime: { width: 48, color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 13 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand500 },
  scheduleCopy: { flex: 1 },
  scheduleName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  scheduleService: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12, marginTop: 3 },
  status: { color: colors.success, fontFamily: fonts.sansBold, fontSize: 10, padding: 7, borderRadius: radius.pill, backgroundColor: colors.brand50 },
  statusWarning: { color: colors.warning, backgroundColor: colors.gold50 },
  weekdays: { flexDirection: 'row' },
  weekday: { width: '14.285%', textAlign: 'center', color: colors.ink500, fontFamily: fonts.sansBold, fontSize: 12 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  day: { width: '14.285%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  dayActive: { backgroundColor: colors.brand600, borderRadius: radius.pill },
  dayText: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 14 },
  dayTextActive: { color: colors.white, fontFamily: fonts.sansBold },
  dayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.gold500 },
  search: { minHeight: 54, borderRadius: radius.pill, backgroundColor: colors.brand50, paddingHorizontal: spacing.lg, color: colors.ink900, fontFamily: fonts.sans, fontSize: 15 },
  clientCard: { backgroundColor: colors.brand700 },
  checkoutItem: { minHeight: 66, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, paddingHorizontal: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  checkoutList: { gap: spacing.sm },
  checkoutItemActive: { backgroundColor: colors.brand50, borderColor: colors.brand600 },
  checkoutPrice: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  receipt: { gap: spacing.md },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between' },
  receiptText: { color: colors.ink700, fontFamily: fonts.sans, fontSize: 14 },
  receiptBold: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18 },
  receiptRule: { height: 1, backgroundColor: colors.ink200 },
  amounts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tipChoice: { minHeight: 46, minWidth: 72, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.ink200, borderRadius: radius.pill },
  success: { color: colors.success, fontFamily: fonts.sansBold, fontSize: 13 },
  notice: { color: colors.success, fontFamily: fonts.sansBold, fontSize: 13, lineHeight: 19 },
  detailCard: { gap: spacing.sm },
  noteRow: { gap: 2 },
  detailHeading: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18 },
  workflowCard: { gap: spacing.md },
  workflowInput: { minHeight: 96, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink300, padding: spacing.md, color: colors.ink900, fontFamily: fonts.sans, fontSize: 15, backgroundColor: colors.white, textAlignVertical: 'top' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});
