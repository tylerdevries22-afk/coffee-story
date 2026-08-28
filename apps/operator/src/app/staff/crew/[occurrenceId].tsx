import { useLocalSearchParams } from 'expo-router';

import { OperationDetailScreen } from '@/screens/staff/operation-detail-screen';

export default function OperationDetailRoute() {
  const { occurrenceId } = useLocalSearchParams<{ occurrenceId: string }>();
  return <OperationDetailScreen occurrenceId={occurrenceId} />;
}
