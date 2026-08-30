import { TabScreenSafeArea } from '@platform/ui';
import { StaffWorkspaceGate } from '@/components/staff/workspace-gate';
import { AdminMoreScreen } from '@/screens/staff/admin-more-screen';
import { useStaffWorkspace } from '@/state/staff-workspace';

export default function StaffMoreRoute() {
  return (
    <StaffWorkspaceGate>
      <TabScreenSafeArea><StaffMoreContent /></TabScreenSafeArea>
    </StaffWorkspaceGate>
  );
}

function StaffMoreContent() {
  const { dashboard } = useStaffWorkspace();
  return <AdminMoreScreen dashboard={dashboard} />;
}
