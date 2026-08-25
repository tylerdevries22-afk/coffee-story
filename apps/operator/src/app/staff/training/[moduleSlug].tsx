import { useLocalSearchParams } from 'expo-router';

import { TrainingModuleScreen } from '@/screens/staff/training-module-screen';

export default function TrainingModuleRoute() {
  const { moduleSlug } = useLocalSearchParams<{ moduleSlug?: string }>();
  return <TrainingModuleScreen moduleSlug={typeof moduleSlug === 'string' ? moduleSlug : ''} />;
}
