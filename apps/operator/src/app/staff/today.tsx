import { TabScreenSafeArea } from '@/components/navigation/tab-screen';
import { TodayScreen } from '@/screens/staff/today-screen';
import { useStaffWorkspace } from '@/state/staff-workspace';

export default function StaffTodayRoute() {
  const { dashboard, updateStatus } = useStaffWorkspace();
  return <TabScreenSafeArea><TodayScreen dashboard={dashboard} onUpdateStatus={updateStatus} /></TabScreenSafeArea>;
}
