import { useLocalSearchParams } from 'expo-router';

import { TrainingLessonScreen } from '@/screens/staff/training-lesson-screen';

export default function TrainingLessonRoute() {
  const { trackSlug, lessonSlug } = useLocalSearchParams<{ trackSlug?: string; lessonSlug?: string }>();
  return <TrainingLessonScreen trackSlug={typeof trackSlug === 'string' ? trackSlug : ''} lessonSlug={typeof lessonSlug === 'string' ? lessonSlug : ''} />;
}
