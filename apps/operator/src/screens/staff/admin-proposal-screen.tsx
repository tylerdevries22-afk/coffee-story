import * as Haptics from 'expo-haptics';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card } from '@/components/ui';
import { workspaceTone } from '@/features/staff/workspace';
import { openWebPath } from '@/lib/web-navigation';
import { useAuth } from '@/state/auth-context';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import { AppIcon } from '@/components/icon';

export function AdminProposalScreen({ onBack }: { onBack: () => void }) {
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
        <View style={styles.heroMark}><AppIcon name="doc.text" size={28} tintColor={colors.brand700} /></View>
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
  return (
    <View style={styles.row}>
      <View style={styles.dot}><AppIcon name="checkmark" size={13} tintColor={colors.white} /></View>
      <View style={styles.copy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>
    </View>
  );
}

function TimelineItem({ index, title, detail }: { index: string; title: string; detail: string }) {
  return (
    <View style={styles.timelineItem}>
      <Text style={styles.index}>{index}</Text>
      <View style={styles.copy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.sm, backgroundColor: colors.gold50, borderColor: colors.gold300 },
  heroMark: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  heroTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 27, lineHeight: 31 },
  sectionTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 22, marginTop: spacing.md },
  row: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: 1, borderBottomColor: 'rgba(70,48,78,0.12)' },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand600 },
  copy: { flex: 1, gap: 3 },
  rowTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  rowDetail: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  timeline: { borderLeftWidth: 2, borderLeftColor: colors.brand200, marginLeft: spacing.md },
  timelineItem: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginLeft: -17 },
  index: { width: 32, height: 32, borderRadius: 16, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center', color: colors.white, backgroundColor: colors.brand600, fontFamily: fonts.sansBold, fontSize: 11 },
});
