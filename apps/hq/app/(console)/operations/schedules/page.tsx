import { OperationsRoute } from '@/components/operations-workspace';
import { loadOperationsWorkspace } from '@/lib/operations-data';

export const dynamic = 'force-dynamic';

export default async function OperationSchedulesPage() {
  return <OperationsRoute view="schedules" workspace={await loadOperationsWorkspace()} />;
}
