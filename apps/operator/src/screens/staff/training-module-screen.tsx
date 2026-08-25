import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/icon';
import { useTrainingRelease } from '@/features/training/use-training-release';
import { colors, fonts, spacing } from '@/theme/tokens';

export function TrainingModuleScreen({ moduleSlug }: { moduleSlug: string }) {
  const { release, loading, error } = useTrainingRelease();
  const module = release?.manifest.modules.find((candidate) => candidate.slug === moduleSlug);
  if (loading) return <TrainingMessage text="Loading module…" />;
  if (error || !release || !module) return <TrainingMessage text={error ?? 'This training module is unavailable.'} />;
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Header title="Training" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}><View style={styles.heroIcon}><AppIcon name="book.closed" size={28} tintColor={colors.brand700} /></View><Text style={styles.title}>{module.title}</Text><Text style={styles.summary}>{module.summary}</Text></View>
        <Text style={styles.sectionTitle}>Lessons</Text>
        {module.lessons.map((lesson, index) => (
          <Pressable key={lesson.slug} accessibilityRole="button" onPress={() => router.push(`/staff/training/${encodeURIComponent(module.slug)}/${encodeURIComponent(lesson.slug)}` as Href)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
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
  return <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><AppIcon name="chevron.left" size={22} tintColor={colors.ink900} /></Pressable><Text style={styles.headerTitle}>{title}</Text><View style={styles.back} /></View>;
}

function TrainingMessage({ text }: { text: string }) {
  return <SafeAreaView style={styles.message}><AppIcon name="book.closed" size={28} tintColor={colors.ink400} /><Text style={styles.summary}>{text}</Text><Pressable onPress={() => router.back()} style={styles.messageButton}><Text style={styles.messageButtonText}>Go back</Text></Pressable></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F0EE' },
  header: { minHeight: 58, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ink200 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 17 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  hero: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl },
  heroIcon: { width: 58, height: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand100 },
  title: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 24, textAlign: 'center' },
  summary: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  sectionTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 19, marginBottom: 2 },
  card: { minHeight: 78, padding: spacing.md, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.ink200 },
  number: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand50 },
  numberText: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 14 },
  copy: { flex: 1, gap: 3 },
  cardTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  meta: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  pressed: { opacity: 0.72 },
  message: { flex: 1, padding: spacing.xl, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: '#F1F0EE' },
  messageButton: { minHeight: 46, paddingHorizontal: spacing.lg, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink900 },
  messageButtonText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 14 },
});
