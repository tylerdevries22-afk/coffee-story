import { OperationsRoute } from '@/components/operations-workspace';
import { loadOperationsWorkspace } from '@/lib/operations-data';

export const dynamic = 'force-dynamic';

export default async function OperationReportingPage() {
  return <OperationsRoute view="reporting" workspace={await loadOperationsWorkspace()} />;
}
