import { router, type Href } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TrainingArtwork } from '@/components/training-artwork';
import { operatorLayout } from '@/lib/responsive-layout';
import { useTrainingRelease } from '@/features/training/use-training-release';
import { useBusiness } from '@/state/business';
import { useAppTokens, type AppTokens, AppIcon } from '@platform/ui';
import { completionReport, isConstructionTrainingProfile, isCoreTrainingTrack, remindersFor, TRAINING_TRACK_ORDER, type TrainingAssignment, type TrainingTrackKey } from '@platform/domain';

const TRACK_LABELS: Record<TrainingTrackKey, string> = {
  knowledge: 'Knowledge', skills: 'Skills', service: 'Service', safety: 'Safety', operations: 'Operations',
};
const TRACK_ICONS: Record<TrainingTrackKey, 'book.closed' | 'gearshape' | 'star' | 'lock' | 'briefcase'> = {
  knowledge: 'book.closed', skills: 'gearshape', service: 'star', safety: 'lock', operations: 'briefcase',
};

export function TrainingScreen() {
  const { colors, styles } = useTrainingTheme();
  const { width, height } = useWindowDimensions();
  const layout = operatorLayout(width, height);
  const business = useBusiness();
  const { release, profile, loading, error, isDemo } = useTrainingRelease();
  const tracks = useMemo(() => release?.manifest.tracks ?? [], [release]);
  const construction = isConstructionTrainingProfile(profile);
  const demoAssignments = useMemo<TrainingAssignment[]>(() => construction ? [
    { trackSlug: 'safety', lessonSlug: 'incident-response', role: 'staff', trade: 'foreman', status: 'complete', completedAt: '2026-08-30', certificationExpiresAt: '2026-09-20' },
    { trackSlug: 'field-skills', lessonSlug: 'pre-task-plan', role: 'staff', trade: 'field_crew', status: 'in_progress' },
    { trackSlug: 'operations', lessonSlug: 'daily-log-and-handoff', role: 'staff', trade: 'superintendent', status: 'complete', completedAt: '2026-09-02', signedOffAt: '2026-09-02', signedOffBy: 'Maya Chen' },
  ] : [
    { trackSlug: 'knowledge', lessonSlug: 'menu-fluency', role: 'staff', trade: 'barista', status: 'complete', completedAt: '2026-09-02', signedOffAt: '2026-09-02', signedOffBy: 'Maya Chen' },
    { trackSlug: 'skills', lessonSlug: 'espresso-execution', role: 'staff', trade: 'barista', status: 'in_progress' },
    { trackSlug: 'safety', lessonSlug: 'chemicals-and-incidents', role: 'staff', trade: 'barista', status: 'complete', completedAt: '2026-08-30', certificationExpiresAt: '2026-09-20' },
  ], [construction]);
  const report = useMemo(() => completionReport(demoAssignments, new Date('2026-09-04')), [demoAssignments]);
  const reminders = useMemo(() => remindersFor(demoAssignments, new Date('2026-09-04')), [demoAssignments]);
  // One lookup on one key. This used to match trackKey OR slug and then list
  // anything without a trackKey as additional, so a track could appear twice.
  const coreTracks = useMemo(() => TRAINING_TRACK_ORDER.map((slug) => tracks.find((track) => track.slug === slug)), [tracks]);
  const tenantTracks = useMemo(() => tracks.filter((track) => !isCoreTrainingTrack(track.slug)), [tracks]);
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
          {coreTracks.map((published, index) => {
            const trackKey = TRAINING_TRACK_ORDER[index] ?? 'knowledge';
            const track = published
              ? { key: published.slug, label: published.title || TRACK_LABELS[trackKey], icon: trackIcon(published.icon.symbol, trackKey), imageUrl: published.icon.url }
              : { key: trackKey, label: TRACK_LABELS[trackKey], icon: TRACK_ICONS[trackKey], imageUrl: undefined };
            return (
            <Pressable
              key={track.key}
              accessibilityRole="button"
              disabled={!release}
              onPress={() => router.push(`/staff/training/${encodeURIComponent(track.key)}` as Href)}
              style={styles.track}
            >
              <View style={styles.trackIcon}>
                <TrainingArtwork url={track.imageUrl} alt={`${track.label} track artwork`} fallback={track.icon} size={52} radius={11} tintColor={colors.brand600} backgroundColor={colors.brand50} />
              </View>
              <Text style={styles.trackLabel}>{track.label}</Text>
            </Pressable>
            );
          })}
        </ScrollView>

        {loading ? <StatusCard title="Preparing training" detail="Loading your tenant curriculum…" /> : null}
        {error ? <StatusCard title="Training unavailable" detail={error} /> : null}
        {!loading && !error && !isDemo && !release ? (
          <StatusCard title="Curriculum is being prepared" detail="This tenant has no published release yet. HQ can research, validate, and publish the first curriculum." />
        ) : null}
        {isDemo ? <TrainingSection title="Demo training progress"><TrainingCard title={construction ? 'Field operations path' : 'Barista path'} subtitle={`Preview only · ${report.completed} of ${report.total} complete · ${reminders.length} follow-ups`} demoProgress={report.percent} /></TrainingSection> : null}
        {isDemo && construction ? <TrainingSection title="Demo curriculum preview"><TrainingCard title={`${business.name || 'Your workspace'} construction curriculum`} subtitle="Preview only · site safety, field skills, and project handoffs" demoProgress={report.percent} onPress={() => router.push('/staff/training/operations' as Href)} /></TrainingSection> : null}
        {release ? (
          <>
          <TrainingSection title="Core Training">
            {coreTracks.map((track, index) => {
              const trackKey = TRAINING_TRACK_ORDER[index] ?? 'knowledge';
              const slug = track?.slug ?? trackKey;
              return <TrainingCard key={slug} title={track?.title || TRACK_LABELS[trackKey]} subtitle={track ? `${track.lessons.length} lessons` : 'No lessons published yet'} onPress={() => router.push(`/staff/training/${encodeURIComponent(slug)}` as Href)} />;
            })}
          </TrainingSection>
          {tenantTracks.length > 0 ? <TrainingSection title="Additional training">{tenantTracks.map((track) => <TrainingCard key={track.slug} title={track.title} subtitle={`${track.lessons.length} lessons`} onPress={() => router.push(`/staff/training/${encodeURIComponent(track.slug)}` as Href)} />)}</TrainingSection> : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function trackIcon(symbol: string, trackKey: TrainingTrackKey): 'book.closed' | 'gearshape' | 'star' | 'lock' | 'briefcase' {
  const normalized = symbol.toLowerCase();
  if (normalized.includes('safety') || normalized.includes('lock')) return 'lock';
  if (normalized.includes('service') || normalized.includes('star')) return 'star';
  if (normalized.includes('operation') || normalized.includes('briefcase')) return 'briefcase';
  if (normalized.includes('skill') || normalized.includes('wrench') || normalized.includes('gear')) return 'gearshape';
  return TRACK_ICONS[trackKey];
}

function StatusCard({ title, detail }: { title: string; detail: string }) {
  const { colors, styles } = useTrainingTheme();
  return <View style={styles.statusCard}><AppIcon name="book.closed" size={24} tintColor={colors.brand600} /><Text style={styles.statusTitle}>{title}</Text><Text style={styles.statusDetail}>{detail}</Text></View>;
}

function TrainingSection({ title, children }: { title: string; children: React.ReactNode }) {
  const { styles } = useTrainingTheme();
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text>{children}</View>;
}

function TrainingCard({ title, subtitle, demoProgress, onPress }: { title: string; subtitle: string; demoProgress?: number; onPress?: () => void }) {
  const { colors, styles } = useTrainingTheme();
  const accessibilityLabel = demoProgress === undefined
    ? `${title}. ${subtitle}`
    : `${title}, demo progress ${demoProgress}%`;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {demoProgress === undefined ? null : <ProgressRing progress={demoProgress} />}
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
