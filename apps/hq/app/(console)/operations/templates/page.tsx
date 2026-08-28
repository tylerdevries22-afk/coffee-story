import { OperationsRoute } from '@/components/operations-workspace';
import { loadOperationsWorkspace } from '@/lib/operations-data';

export const dynamic = 'force-dynamic';

export default async function OperationTemplatesPage() {
  return <OperationsRoute view="templates" workspace={await loadOperationsWorkspace()} />;
}
