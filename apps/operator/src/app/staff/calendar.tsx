import { TabScreenSafeArea } from '@/components/navigation/tab-screen';
import { CalendarScreen } from '@/screens/staff/calendar-screen';
import { useStaffWorkspace } from '@/state/staff-workspace';

export default function StaffCalendarRoute() {
  const { dashboard, updateStatus } = useStaffWorkspace();
  return <TabScreenSafeArea><CalendarScreen appointments={dashboard.appointments} onUpdateStatus={updateStatus} /></TabScreenSafeArea>;
}
