import { TabScreenSafeArea } from '@/components/navigation/tab-screen';
import { StaffWorkspaceGate } from '@/components/staff/workspace-gate';
import { TodayScreen } from '@/screens/staff/today-screen';
import { useStaffWorkspace } from '@/state/staff-workspace';

export default function StaffTodayRoute() {
  return (
    <StaffWorkspaceGate>
      <TabScreenSafeArea><StaffTodayContent /></TabScreenSafeArea>
    </StaffWorkspaceGate>
  );
}

function StaffTodayContent() {
  const { dashboard, updateStatus } = useStaffWorkspace();
  return <TodayScreen dashboard={dashboard} onUpdateStatus={updateStatus} />;
}
