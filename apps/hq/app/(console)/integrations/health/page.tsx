import { IntegrationWorkspace } from '@/components/integration-workspace';
import { filterConnectorCards } from '@/lib/integration-cards';
import { loadConnectorCards } from '@/lib/integration-data';

export const dynamic = 'force-dynamic';

export default async function IntegrationHealthPage() {
  const cards = filterConnectorCards(await loadConnectorCards(), 'health');
  return <IntegrationWorkspace view="health" cards={cards} />;
}
