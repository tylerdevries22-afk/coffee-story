import { TabScreenSafeArea } from '@/components/navigation/tab-screen';
import { AdminMoreScreen } from '@/screens/staff/admin-more-screen';
import { useStaffWorkspace } from '@/state/staff-workspace';

export default function StaffMoreRoute() {
  const { dashboard } = useStaffWorkspace();
  return <TabScreenSafeArea><AdminMoreScreen dashboard={dashboard} /></TabScreenSafeArea>;
}
