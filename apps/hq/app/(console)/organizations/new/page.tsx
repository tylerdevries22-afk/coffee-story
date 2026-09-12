import { redirect } from 'next/navigation';

import { OrganizationOnboardingWizard } from '@/components/organization-onboarding-wizard';
import { currentAuthUser, currentSession } from '@/lib/auth';
import { connectorCardsOf, defaultConnectorCards } from '@/lib/integration-cards';
import { serverClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function NewOrganizationPage() {
  const [session, authUser] = await Promise.all([currentSession(), currentAuthUser()]);
  if (!session && !authUser) redirect('/login');
  const client = await serverClient();
  const registry = await client?.from('connector_registry')
    .select('id,provider_key,availability,is_active').eq('is_active', true);
  const connectorCards = client
    ? connectorCardsOf(registry?.data ?? [], [])
    : defaultConnectorCards();

  return <OrganizationOnboardingWizard idempotencyKey={crypto.randomUUID()}
    ownerEmail={session?.email || authUser?.email || ''} connectorCards={connectorCards} />;
}
