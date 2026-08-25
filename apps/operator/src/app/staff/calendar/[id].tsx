import { useLocalSearchParams } from 'expo-router';

import { CalendarDetailScreen } from '@/screens/staff/calendar-detail-screen';

export default function StaffCalendarDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <CalendarDetailScreen itemId={typeof id === 'string' ? id : ''} />;
}
