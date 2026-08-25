import { useLocalSearchParams } from 'expo-router';

import { TrainingLessonScreen } from '@/screens/staff/training-lesson-screen';

export default function TrainingLessonRoute() {
  const { moduleSlug, lessonSlug } = useLocalSearchParams<{ moduleSlug?: string; lessonSlug?: string }>();
  return <TrainingLessonScreen moduleSlug={typeof moduleSlug === 'string' ? moduleSlug : ''} lessonSlug={typeof lessonSlug === 'string' ? lessonSlug : ''} />;
}
