import { resolveActivityBoardConfig } from '@platform/domain';

import { ActivityKanbanScreen } from '@/screens/staff/activity-kanban-screen';
import { OrdersBoardScreen } from '@/screens/staff/orders-board-screen';
import { useAuth } from '@/state/auth-context';

export default function StaffOrdersRoute() {
  const { brandConfig } = useAuth();
  const activity = resolveActivityBoardConfig(brandConfig);
  if (activity.enabled) return <ActivityKanbanScreen config={activity} />;
  return <OrdersBoardScreen />;
}
