import { useLocalSearchParams } from 'expo-router';

import { TrainingTrackScreen } from '@/screens/staff/training-track-screen';

export default function TrainingTrackRoute() {
  const { trackSlug } = useLocalSearchParams<{ trackSlug?: string }>();
  return <TrainingTrackScreen trackSlug={typeof trackSlug === 'string' ? trackSlug : ''} />;
}
