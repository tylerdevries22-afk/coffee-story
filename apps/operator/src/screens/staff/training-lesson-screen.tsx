import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/icon';
import { TrainingArtwork } from '@/components/training-artwork';
import { useTrainingRelease } from '@/features/training/use-training-release';
import { platformApi } from '@/lib/api';
import { useAppTokens, type AppTokens } from '@platform/ui';
import { scoreTrainingQuiz } from '@platform/domain';

export function TrainingLessonScreen({ moduleSlug, lessonSlug }: { moduleSlug: string; lessonSlug: string }) {
  const { colors, styles } = useTrainingLessonTheme();
  const { release, loading, error, isDemo } = useTrainingRelease();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const module = release?.manifest.modules.find((candidate) => candidate.slug === moduleSlug);
  const lesson = module?.lessons.find((candidate) => candidate.slug === lessonSlug);
  const answerList = useMemo(() => lesson?.quiz.map((_, index) => answers[index] ?? -1) ?? [], [answers, lesson]);
  if (loading) return <LessonMessage text="Loading lesson…" />;
  if (error || !release || !lesson) return <LessonMessage text={error ?? 'This lesson is unavailable.'} />;

  const submit = async () => {
    if (answerList.some((answer) => answer < 0)) return;
    setSubmitting(true);
    try {
      const scored = isDemo
        ? scoreTrainingQuiz(lesson.quiz, answerList)
        : platformApi
          ? await platformApi.submitTrainingQuiz({ releaseId: release.id, moduleSlug, lessonSlug, answers: answerList })
          : { score: 0, passed: false };
      setResult(scored);
    } catch {
      setResult({ score: 0, passed: false });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><AppIcon name="chevron.left" size={22} tintColor={colors.ink900} /></Pressable><Text numberOfLines={1} style={styles.headerTitle}>{module?.title ?? 'Training'}</Text><View style={styles.back} /></View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>{lesson.estimatedMinutes} MINUTE LESSON</Text><Text style={styles.title}>{lesson.title}</Text><Text style={styles.objective}>{lesson.objective}</Text>
        <View style={styles.card}><Text style={styles.body}>{lesson.content}</Text></View>
        {lesson.media.map((media) => <Pressable key={media.url} accessibilityRole="link" onPress={() => { if (media.url.startsWith('https://')) void Linking.openURL(media.url); }} style={styles.media}><TrainingArtwork url={media.kind === 'image' ? media.url : undefined} alt={media.title} fallback={media.kind === 'video' ? 'play.fill' : 'photo'} size={48} radius={9} tintColor={colors.brand700} backgroundColor={colors.brand50} /><View style={styles.mediaCopy}><Text style={styles.mediaTitle}>{media.title}</Text><Text style={styles.mediaNote}>{media.rightsNote}</Text></View><AppIcon name="arrow.up.right" size={15} tintColor={colors.ink500} /></Pressable>)}
        <Text style={styles.sectionTitle}>Knowledge check</Text>
        {lesson.quiz.map((question, questionIndex) => <View key={question.prompt} style={styles.card}><Text style={styles.question}>{questionIndex + 1}. {question.prompt}</Text>{question.choices.map((choice, choiceIndex) => <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ checked: answers[questionIndex] === choiceIndex }} onPress={() => setAnswers((current) => ({ ...current, [questionIndex]: choiceIndex }))} style={[styles.choice, answers[questionIndex] === choiceIndex && styles.choiceSelected]}><Text style={styles.choiceText}>{choice}</Text></Pressable>)}</View>)}
        {result ? <View style={[styles.result, result.passed ? styles.resultPassed : styles.resultRetry]}><Text style={styles.resultTitle}>{result.passed ? 'Lesson complete' : 'Review and try again'}</Text><Text style={styles.resultText}>{result.score}%</Text></View> : null}
        <Pressable accessibilityRole="button" disabled={submitting || answerList.some((answer) => answer < 0)} onPress={() => void submit()} style={({ pressed }) => [styles.submit, (submitting || answerList.some((answer) => answer < 0)) && styles.disabled, pressed && styles.pressed]}><Text style={styles.submitText}>{submitting ? 'Checking…' : 'Submit answers'}</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function LessonMessage({ text }: { text: string }) {
  const { colors, styles } = useTrainingLessonTheme();
  return <SafeAreaView style={styles.message}><AppIcon name="book.closed" size={28} tintColor={colors.ink400} /><Text style={styles.objective}>{text}</Text><Pressable onPress={() => router.back()} style={styles.submit}><Text style={styles.submitText}>Go back</Text></Pressable></SafeAreaView>;
}

function useTrainingLessonTheme() {
  const appTokens = useAppTokens();
  return { colors: appTokens.colors, styles: createStyles(appTokens) };
}

function createStyles({ colors, fonts, spacing }: AppTokens) {
  return StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F0EE' }, header: { minHeight: 58, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.ink200 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, headerTitle: { maxWidth: '70%', color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 17 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm }, eyebrow: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 10, letterSpacing: 0.8 }, title: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 25 }, objective: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, textAlign: 'center' }, body: { color: colors.ink700, fontFamily: fonts.sans, fontSize: 15, lineHeight: 23 },
  card: { padding: spacing.md, gap: spacing.sm, borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.ink200 }, media: { minHeight: 66, padding: spacing.md, gap: spacing.sm, flexDirection: 'row', alignItems: 'center', borderRadius: 12, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.ink200 }, mediaCopy: { flex: 1, gap: 2 }, mediaTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 }, mediaNote: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 10 }, sectionTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 19, marginTop: spacing.md }, question: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15, lineHeight: 21 }, choice: { minHeight: 46, paddingHorizontal: spacing.md, borderRadius: 9, justifyContent: 'center', backgroundColor: colors.warm, borderWidth: 1, borderColor: colors.ink200 }, choiceSelected: { borderColor: colors.brand700, backgroundColor: colors.brand50 }, choiceText: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 13 },
  result: { padding: spacing.md, alignItems: 'center', gap: 3, borderRadius: 12 }, resultPassed: { backgroundColor: '#E6F3EA' }, resultRetry: { backgroundColor: '#FBF3DB' }, resultTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 }, resultText: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 13 }, submit: { minHeight: 52, paddingHorizontal: spacing.lg, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink900 }, submitText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 15 }, disabled: { opacity: 0.38 }, pressed: { opacity: 0.72 }, message: { flex: 1, padding: spacing.xl, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: '#F1F0EE' },
  });
}
