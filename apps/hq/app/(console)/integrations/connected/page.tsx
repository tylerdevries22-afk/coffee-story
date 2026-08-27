import { IntegrationWorkspace } from '@/components/integration-workspace';
import { filterConnectorCards } from '@/lib/integration-cards';
import { loadConnectorCards } from '@/lib/integration-data';

export const dynamic = 'force-dynamic';

export default async function ConnectedIntegrationsPage() {
  const cards = filterConnectorCards(await loadConnectorCards(), 'connected');
  return <IntegrationWorkspace view="connected" cards={cards} />;
}
