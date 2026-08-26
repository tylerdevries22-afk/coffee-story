import { router, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/icon';
import { TrainingArtwork } from '@/components/training-artwork';
import { operatorLayout } from '@/lib/responsive-layout';
import { useTrainingRelease } from '@/features/training/use-training-release';
import { useBusiness } from '@/state/business';
import { useAppTokens, type AppTokens } from '@platform/ui';

const TRACKS = [
  { label: 'Knowledge', icon: 'book.closed' as const },
  { label: 'Service', icon: 'star' as const },
  { label: 'Safety', icon: 'lock' as const },
  { label: 'Operations', icon: 'briefcase' as const },
] as const;

export function TrainingScreen() {
  const { colors, styles } = useTrainingTheme();
  const { width, height } = useWindowDimensions();
  const layout = operatorLayout(width, height);
  const business = useBusiness();
  const { release, loading, error, isDemo } = useTrainingRelease();
  const modules = useMemo(() => release?.manifest.modules ?? [], [release]);
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={[styles.header, layout.isTablet && { maxWidth: layout.contentMaxWidth, width: '100%', alignSelf: 'center' }]}>
        <Text style={styles.title}>Training</Text>
        <Text style={styles.subtitle}>{business.name || 'Your workspace'}</Text>
      </View>
      <ScrollView
        style={layout.isTablet ? { width: '100%', maxWidth: layout.contentMaxWidth, alignSelf: 'center' } : undefined}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trackRail}>
          {(modules.length > 0
            ? modules.map((module) => ({ key: module.slug, label: module.title, icon: moduleIcon(module.icon.symbol), imageUrl: module.icon.url }))
            : TRACKS.map((track) => ({ key: track.label, ...track, imageUrl: undefined }))).map((track) => (
            <Pressable
              key={track.key}
              accessibilityRole="button"
              onPress={modules.length > 0 ? () => router.push(`/staff/training/${encodeURIComponent(track.key)}` as Href) : undefined}
              style={styles.track}
            >
              <View style={styles.trackIcon}>
                <TrainingArtwork url={track.imageUrl} alt={`${track.label} module artwork`} fallback={track.icon} size={52} radius={11} tintColor={colors.brand600} backgroundColor={colors.brand50} />
              </View>
              <Text style={styles.trackLabel}>{track.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? <StatusCard title="Preparing training" detail="Loading your tenant curriculum…" /> : null}
        {error ? <StatusCard title="Training unavailable" detail={error} /> : null}
        {!loading && !error && !isDemo && modules.length === 0 ? (
          <StatusCard title="Curriculum is being prepared" detail="This tenant has no published modules yet. The bootstrap automation can research, validate, and publish the first release." />
        ) : null}
        {isDemo ? <>
          <TrainingSection title="Weekly Training"><TrainingCard title="This week" subtitle="2 modules assigned" progress={50} /></TrainingSection>
          <TrainingSection title="Core Training"><TrainingCard title="Knowledge" subtitle="3/8 completed" progress={38} /><TrainingCard title="Skills" subtitle="2/10 completed" progress={20} /></TrainingSection>
        </> : null}
        {modules.length > 0 ? (
          <TrainingSection title="Core Training">
            {modules.map((module) => <TrainingCard key={module.slug} title={module.title} subtitle={`${module.lessons.length} lessons`} progress={0} onPress={() => router.push(`/staff/training/${encodeURIComponent(module.slug)}` as Href)} />)}
          </TrainingSection>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function moduleIcon(symbol: string): (typeof TRACKS)[number]['icon'] {
  const normalized = symbol.toLowerCase();
  if (normalized.includes('safety') || normalized.includes('lock')) return 'lock';
  if (normalized.includes('service') || normalized.includes('star')) return 'star';
  if (normalized.includes('operation') || normalized.includes('briefcase')) return 'briefcase';
  return 'book.closed';
}

function StatusCard({ title, detail }: { title: string; detail: string }) {
  const { colors, styles } = useTrainingTheme();
  return <View style={styles.statusCard}><AppIcon name="book.closed" size={24} tintColor={colors.brand600} /><Text style={styles.statusTitle}>{title}</Text><Text style={styles.statusDetail}>{detail}</Text></View>;
}

function TrainingSection({ title, children }: { title: string; children: React.ReactNode }) {
  const { styles } = useTrainingTheme();
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function TrainingCard({ title, subtitle, progress, onPress }: { title: string; subtitle: string; progress: number; onPress?: () => void }) {
  const { colors, styles } = useTrainingTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}, ${progress}% complete`} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <ProgressRing progress={progress} />
      <View style={styles.cardCopy}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.cardSubtitle}>{subtitle}</Text></View>
      <AppIcon name="chevron.right" size={17} tintColor={colors.ink400} />
    </Pressable>
  );
}

function ProgressRing({ progress }: { progress: number }) {
  const { colors, styles } = useTrainingTheme();
  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={styles.ring}>
      <Svg width={64} height={64} viewBox="0 0 64 64">
        <Circle cx="32" cy="32" r={radius} fill="none" stroke={colors.ink200} strokeWidth="7" />
        <Circle cx="32" cy="32" r={radius} fill="none" stroke={colors.brand400} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - progress / 100)} transform="rotate(-90 32 32)" />
      </Svg>
      <Text style={styles.ringText}>{progress}%</Text>
    </View>
  );
}

function useTrainingTheme() {
  const appTokens = useAppTokens();
  return { colors: appTokens.colors, styles: createStyles(appTokens) };
}

function createStyles({ colors, fonts, spacing }: AppTokens) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.warm },
  header: { minHeight: 74, justifyContent: 'center', paddingHorizontal: spacing.lg, backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ink200 },
  title: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 25, letterSpacing: -0.5 },
  subtitle: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12, marginTop: 2 },
  content: { paddingBottom: 110 },
  trackRail: { backgroundColor: colors.white, paddingHorizontal: spacing.md, paddingVertical: spacing.lg, gap: spacing.md },
  track: { width: 72, alignItems: 'center', gap: 7 },
  trackIcon: { width: 54, height: 54, borderRadius: 12, backgroundColor: colors.brand50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.brand100, overflow: 'hidden' },
  trackLabel: { color: colors.ink600, fontFamily: fonts.sansMedium, fontSize: 10, textAlign: 'center' },
  section: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, gap: spacing.sm },
  sectionTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 20, letterSpacing: -0.2 },
  card: { minHeight: 106, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, backgroundColor: colors.white, borderRadius: 12, borderWidth: 1, borderColor: colors.ink200 },
  pressed: { opacity: 0.72 },
  cardCopy: { flex: 1, gap: 3 },
  cardTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18 },
  cardSubtitle: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13 },
  ring: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  ringText: { position: 'absolute', color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 11 },
  statusCard: { margin: spacing.md, minHeight: 150, padding: spacing.lg, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.ink200 },
  statusTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 17, textAlign: 'center' },
  statusDetail: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  });
}
