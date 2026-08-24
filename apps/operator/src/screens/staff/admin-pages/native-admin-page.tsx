import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, PillRow, SectionTitle } from '@/components/ui';
import { NATIVE_ADMIN_PAGES } from '@/features/admin/admin-pages/content';
import { workspaceTone } from '@/features/staff/workspace';
import { useAuth } from '@/state/auth-context';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

export function Metric({ label, value }: { label: string; value: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
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
            placeholderTextColor={tokens.textMuted}
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

export const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  shell: { flex: 1 },
  metrics: { flexDirection: 'row', gap: tokens.spacing.md },
  metric: { flex: 1, minHeight: 92, borderRadius: tokens.radius.lg, backgroundColor: tokens.surface, alignItems: 'center', justifyContent: 'center' },
  metricValue: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 28 },
  metricLabel: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11 },
  nextCard: { backgroundColor: tokens.primary, gap: tokens.spacing.md },
  nextTime: { color: tokens.surface, fontFamily: tokens.fontBody, fontSize: 13 },
  nextName: { color: tokens.surfaceElevated, fontFamily: tokens.fontDisplay, fontSize: 28 },
  actions: { flexDirection: 'row', gap: tokens.spacing.md, marginTop: tokens.spacing.md },
  actionButton: { flex: 1, minHeight: 46 },
  scheduleRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, borderBottomWidth: 1, borderBottomColor: tokens.secondary },
  scheduleTime: { width: 48, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: tokens.secondary },
  scheduleCopy: { flex: 1 },
  scheduleName: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  scheduleService: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, marginTop: 3 },
  status: { color: tokens.success, fontFamily: tokens.fontBody, fontSize: 10, padding: 7, borderRadius: tokens.radius.pill, backgroundColor: tokens.surface },
  statusWarning: { color: tokens.warning, backgroundColor: tokens.surface },
  weekdays: { flexDirection: 'row' },
  weekday: { width: '14.285%', textAlign: 'center', color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  day: { width: '14.285%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  dayActive: { backgroundColor: tokens.primary, borderRadius: tokens.radius.pill },
  dayText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  dayTextActive: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody },
  dayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: tokens.accent },
  search: { minHeight: 54, borderRadius: tokens.radius.pill, backgroundColor: tokens.surface, paddingHorizontal: tokens.spacing.xl, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  clientCard: { backgroundColor: tokens.primary },
  checkoutItem: { minHeight: 66, borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: tokens.secondary, paddingHorizontal: tokens.spacing.lg, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  checkoutList: { gap: tokens.spacing.md },
  checkoutItemActive: { backgroundColor: tokens.surface, borderColor: tokens.primary },
  checkoutPrice: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  receipt: { gap: tokens.spacing.lg },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between' },
  receiptText: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 14 },
  receiptBold: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 18 },
  receiptRule: { height: 1, backgroundColor: tokens.secondary },
  amounts: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.md },
  tipChoice: { minHeight: 46, minWidth: 72, paddingHorizontal: tokens.spacing.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: tokens.secondary, borderRadius: tokens.radius.pill },
  success: { color: tokens.success, fontFamily: tokens.fontBody, fontSize: 13 },
  notice: { color: tokens.success, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 19 },
  detailCard: { gap: tokens.spacing.md },
  noteRow: { gap: 2 },
  detailHeading: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 18 },
  workflowCard: { gap: tokens.spacing.lg },
  workflowInput: { minHeight: 96, borderRadius: tokens.radius.lg, borderWidth: 1, borderColor: tokens.textMuted, padding: tokens.spacing.lg, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15, backgroundColor: tokens.surfaceElevated, textAlignVertical: 'top' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
});
