import { IntegrationWorkspace } from '@/components/integration-workspace';
import { loadConnectorCards, loadIntegrationActivity } from '@/lib/integration-data';

export const dynamic = 'force-dynamic';

export default async function IntegrationActivityPage() {
  const [cards, activity] = await Promise.all([loadConnectorCards(), loadIntegrationActivity()]);
  return <IntegrationWorkspace view="activity" cards={cards} activity={activity} />;
}
