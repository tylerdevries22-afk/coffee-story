import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TrainingArtwork } from '@/components/training-artwork';
import { useTrainingRelease } from '@/features/training/use-training-release';
import { useAppTokens, type AppTokens, AppIcon } from '@platform/ui';

export function TrainingTrackScreen({ trackSlug }: { trackSlug: string }) {
  const { colors, styles } = useTrainingTrackTheme();
  const { release, loading, error } = useTrainingRelease();
  const track = release?.manifest.tracks.find((candidate) => candidate.slug === trackSlug);
  if (loading) return <TrainingMessage text="Loading track…" />;
  if (error || !release || !track) return <TrainingMessage text={error ?? 'This training track is unavailable.'} />;
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Header title="Training" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}><View style={styles.heroIcon}><TrainingArtwork url={track.icon.url} alt={`${track.title} track artwork`} fallback="book.closed" size={58} radius={16} tintColor={colors.brand700} backgroundColor={colors.brand100} /></View><Text style={styles.title}>{track.title}</Text><Text style={styles.summary}>{track.summary}</Text></View>
        <Text style={styles.sectionTitle}>Lessons</Text>
        {track.lessons.length === 0 ? <View style={styles.empty}><AppIcon name="book.closed" size={24} tintColor={colors.ink400} /><Text style={styles.meta}>This track has no lessons published yet.</Text></View> : null}
        {track.lessons.map((lesson, index) => (
          <Pressable key={lesson.slug} accessibilityRole="button" onPress={() => router.push(`/staff/training/${encodeURIComponent(track.slug)}/${encodeURIComponent(lesson.slug)}` as Href)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
            <View style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View>
            <View style={styles.copy}><Text style={styles.cardTitle}>{lesson.title}</Text><Text style={styles.meta}>{lesson.estimatedMinutes} min · {lesson.quiz.length} questions</Text></View>
            <AppIcon name="chevron.right" size={16} tintColor={colors.ink400} />
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title }: { title: string }) {
  const { colors, styles } = useTrainingTrackTheme();
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><AppIcon name="chevron.left" size={22} tintColor={colors.ink900} /></Pressable><Text style={styles.headerTitle}>{title}</Text><View style={styles.back} /></View>;
}

function TrainingMessage({ text }: { text: string }) {
  const { colors, styles } = useTrainingTrackTheme();
  return <SafeAreaView style={styles.message}><AppIcon name="book.closed" size={28} tintColor={colors.ink400} /><Text style={styles.summary}>{text}</Text><Pressable onPress={() => router.back()} style={styles.messageButton}><Text style={styles.messageButtonText}>Go back</Text></Pressable></SafeAreaView>;
}

function useTrainingTrackTheme() {
  const appTokens = useAppTokens();
  return { colors: appTokens.colors, styles: createStyles(appTokens) };
}

function createStyles({ colors, fonts, spacing }: AppTokens) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.warm },
  header: { minHeight: 58, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ink200 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 17 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  hero: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  heroIcon: { width: 58, height: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand100, overflow: 'hidden' },
  title: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 24, textAlign: 'center' },
  summary: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  sectionTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 19, marginBottom: 2 },
  card: { minHeight: 78, padding: spacing.md, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.ink200 },
  number: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand50 },
  numberText: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 14 },
  copy: { flex: 1, gap: 3 },
  cardTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  meta: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  empty: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.ink200 },
  pressed: { opacity: 0.72 },
  message: { flex: 1, padding: spacing.xl, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.warm },
  messageButton: { minHeight: 46, paddingHorizontal: spacing.lg, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink900 },
  messageButtonText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 14 },
  });
}
