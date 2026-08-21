import { TabScreenSafeArea } from '@/components/navigation/tab-screen';
import { ClientsScreen } from '@/screens/staff/clients-screen';
import { useStaffWorkspace } from '@/state/staff-workspace';

export default function StaffClientsRoute() {
  const { dashboard } = useStaffWorkspace();
  return <TabScreenSafeArea><ClientsScreen dashboard={dashboard} /></TabScreenSafeArea>;
}
