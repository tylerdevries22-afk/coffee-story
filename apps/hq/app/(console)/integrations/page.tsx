import { IntegrationWorkspace } from '@/components/integration-workspace';
import { loadConnectorCards } from '@/lib/integration-data';

export const dynamic = 'force-dynamic';

export default async function IntegrationsPage() {
  return <IntegrationWorkspace view="catalog" cards={await loadConnectorCards()} />;
}
