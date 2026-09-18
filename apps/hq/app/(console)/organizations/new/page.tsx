import { redirect } from 'next/navigation';

import { OrganizationOnboardingWizard } from '@/components/organization-onboarding-wizard';
import { currentSession, mayProvisionOrganizations } from '@/lib/auth';
import { connectorCardsOf, defaultConnectorCards } from '@/lib/integration-cards';
import { placesKey } from '@/lib/places-proxy-context';
import { serverClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function NewOrganizationPage() {
  // The page is its own gate. Hiding the nav link was the only restriction
  // before, and the console layout cannot stand in for this check: Next
  // renders a page and its layout in parallel.
  const session = await currentSession();
  if (!mayProvisionOrganizations(session)) redirect('/');
  const client = await serverClient();
  const registry = await client?.from('connector_registry')
    .select('id,provider_key,availability,is_active').eq('is_active', true);
  const connectorCards = client
    ? connectorCardsOf(registry?.data ?? [], [])
    : defaultConnectorCards();

  // Only whether a key is set crosses to the browser, never the key: without
  // one the wizard opens for typing instead of offering a search that can't answer.
  return <OrganizationOnboardingWizard idempotencyKey={crypto.randomUUID()}
    ownerEmail={session.email} connectorCards={connectorCards} placesReady={placesKey() !== undefined} />;
}
