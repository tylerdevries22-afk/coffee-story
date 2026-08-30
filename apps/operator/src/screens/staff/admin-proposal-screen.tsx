import * as Haptics from 'expo-haptics';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card } from '@/components/ui';
import { workspaceTone } from '@/features/staff/workspace';
import { openWebPath } from '@/lib/web-navigation';
import { useAuth } from '@/state/auth-context';
import { AppIcon } from '@/components/icon';
import { hairline, useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

export function AdminProposalScreen({ onBack }: { onBack: () => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { role } = useAuth();
  const tone = workspaceTone(role);
  function open(path: '/proposal' | '/') {
    void Haptics.selectionAsync();
    void openWebPath(path).catch((error: unknown) => {
      Alert.alert('Page unavailable', error instanceof Error ? error.message : 'Try again in a moment.');
    });
  }
  return (
    <CollapsingScreen title="Website Proposal" eyebrow="Guest document" onBack={onBack} tone={tone}>
      <Body muted>A native overview of the approved website direction, delivery scope, and launch path.</Body>
      <Card style={styles.hero}>
        <View style={styles.heroMark}><AppIcon name="doc.text" size={28} tintColor={tokens.primary} /></View>
        <Text style={styles.heroTitle}>One connected care experience</Text>
        <Body>Website discovery, client booking, rewards, gifting, and staff operations share one calm brand system.</Body>
      </Card>
      <Text style={styles.sectionTitle}>Included in the proposal</Text>
      <ProposalRow title="Guest experience" detail="MenuItem discovery, booking, preferences, memberships, gifts, and rewards." />
      <ProposalRow title="Staff operations" detail="Schedule, clients, checkout, services, settings, and reports." />
      <ProposalRow title="Production foundation" detail="Responsive accessibility, secure data boundaries, analytics, and release readiness." />
      <Text style={styles.sectionTitle}>Current handoff</Text>
      <View style={styles.timeline}>
        <TimelineItem index="01" title="Review" detail="Open the full proposal and confirm scope." />
        <TimelineItem index="02" title="Refine" detail="Capture final brand, content, and workflow decisions." />
        <TimelineItem index="03" title="Launch" detail="Verify production data, payments, and distribution." />
      </View>
      <Button label="Open full proposal" onPress={() => open('/proposal')} />
      <Button label="View public website" variant="secondary" onPress={() => open('/')} />
    </CollapsingScreen>
  );
}

function ProposalRow({ title, detail }: { title: string; detail: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.row}>
      <View style={styles.dot}><AppIcon name="checkmark" size={13} tintColor={tokens.surfaceElevated} /></View>
      <View style={styles.copy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>
    </View>
  );
}

function TimelineItem({ index, title, detail }: { index: string; title: string; detail: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.timelineItem}>
      <Text style={styles.index}>{index}</Text>
      <View style={styles.copy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>
    </View>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  hero: { gap: tokens.spacing.md, backgroundColor: tokens.surface, borderColor: tokens.accent },
  heroMark: { width: 52, height: 52, borderRadius: tokens.radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.surfaceElevated },
  heroTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 27, lineHeight: 31 },
  sectionTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 22, marginTop: tokens.spacing.lg },
  row: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.lg, borderBottomWidth: 1, borderBottomColor: hairline(tokens) },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.primary },
  copy: { flex: 1, gap: 3 },
  rowTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  rowDetail: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 19 },
  timeline: { borderLeftWidth: 2, borderLeftColor: tokens.surface, marginLeft: tokens.spacing.lg },
  timelineItem: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.lg, marginLeft: -17 },
  index: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center', color: tokens.surfaceElevated, backgroundColor: tokens.primary, fontFamily: tokens.fontBody, fontSize: 11 },
});
