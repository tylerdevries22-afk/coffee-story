import type { SupabaseClient } from '@supabase/supabase-js';

import {
  connectorCardsOf,
  defaultConnectorCards,
  type ConnectorCard,
  type ConnectorInstallationRow,
  type ConnectorRegistryRow,
  type IntegrationActivity,
} from './integration-cards';
import { serverClient } from './supabase-server';
import { currentSession } from './auth';

async function selectedBrandId(): Promise<string | null> {
  const session = await currentSession();
  if (!session) return null;
  const { selectedOrganizationId } = await import('./workspace-scope');
  return selectedOrganizationId(session);
}

/** Loads tenant-visible connector metadata while keeping an unavailable schema non-fatal. */
export async function loadConnectorCards(
  providedClient?: SupabaseClient | null,
): Promise<readonly ConnectorCard[]> {
  const client = providedClient === undefined ? await serverClient() : providedClient;
  if (!client) return defaultConnectorCards();
  const brandId = await selectedBrandId();
  if (!brandId) return defaultConnectorCards();
  const [registry, installations] = await Promise.all([
    client
      .from('connector_registry')
      .select('id, provider_key, availability, is_active')
      .order('display_name')
      .returns<ConnectorRegistryRow[]>(),
    client
      .from('connector_installations')
      .select('id, provider_id, status, external_account_label, enabled_capabilities, connected_at, last_synced_at, updated_at')
      .eq('brand_id', brandId)
      .order('updated_at', { ascending: false })
      .returns<ConnectorInstallationRow[]>(),
  ]);
  if (registry.error || installations.error) return defaultConnectorCards();
  return connectorCardsOf(registry.data ?? [], installations.data ?? []);
}

type SyncRunRow = {
  readonly id: string;
  readonly installation_id: string;
  readonly capability_key: string;
  readonly status: string;
  readonly trigger_kind: string;
  readonly records_read: number;
  readonly records_written: number;
  readonly created_at: string;
};

type InstallationProviderRow = {
  readonly id: string;
  readonly provider_id: string;
};

/** Loads the newest tenant-visible connector runs without exposing provider identifiers. */
export async function loadIntegrationActivity(
  providedClient?: SupabaseClient | null,
): Promise<readonly IntegrationActivity[]> {
  const client = providedClient === undefined ? await serverClient() : providedClient;
  if (!client) return [];
  const brandId = await selectedBrandId();
  if (!brandId) return [];
  const [runs, installations, providers] = await Promise.all([
    client.from('connector_sync_runs')
      .select('id, installation_id, capability_key, status, trigger_kind, records_read, records_written, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false }).limit(100).returns<SyncRunRow[]>(),
    client.from('connector_installations').select('id, provider_id').eq('brand_id', brandId)
      .returns<InstallationProviderRow[]>(),
    client.from('connector_registry').select('id, display_name').returns<{ id: string; display_name: string }[]>(),
  ]);
  if (runs.error || installations.error || providers.error) return [];
  const providerIdByInstallation = new Map(
    (installations.data ?? []).map((installation) => [installation.id, installation.provider_id]),
  );
  const providerNames = new Map((providers.data ?? []).map((provider) => [provider.id, provider.display_name]));
  return (runs.data ?? []).map((run) => ({
    id: run.id,
    providerName: providerNames.get(providerIdByInstallation.get(run.installation_id) ?? '') ?? 'Provider',
    capability: run.capability_key,
    status: run.status.replaceAll('_', ' '),
    trigger: run.trigger_kind,
    records: run.records_read + run.records_written,
    createdAt: run.created_at,
  }));
}
