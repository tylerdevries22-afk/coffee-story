import {
  listConnectorCatalog,
  type ConnectorAvailability,
  type ConnectorCatalogEntry,
  type ConnectorCategory,
  type ConnectorInstallationStatus,
  type ConnectorSetup,
} from '@platform/integrations';

import {
  normalizedStatus,
  registryAllowsConfiguration,
  registryStatus,
  STATUS_LABELS,
  type ConnectorRegistryRow,
} from './integration-card-status';

export type { ConnectorRegistryRow } from './integration-card-status';

export type ConnectorInstallationRow = {
  readonly id: string;
  readonly provider_id: string;
  readonly status: string;
  readonly external_account_label: string;
  readonly enabled_capabilities: readonly string[];
  readonly connected_at: string | null;
  readonly last_synced_at: string | null;
  readonly updated_at: string;
};

export type ConnectorCard = {
  readonly id: string;
  readonly displayName: string;
  readonly summary: string;
  readonly category: ConnectorCategory;
  readonly availability: ConnectorAvailability;
  readonly status: ConnectorInstallationStatus;
  readonly statusLabel: string;
  readonly accountLabel: string | null;
  readonly capabilityCount: number;
  /**
   * Capabilities this deployment could enable, given the scopes it actually
   * requests. Lower than `capabilityCount` whenever a scope is deliberately
   * withheld — Meta's publishing permissions pending App Review, for instance —
   * so it is the only honest denominator for "did the user grant everything".
   * Defaults to `capabilityCount` until the capability rows are known.
   */
  readonly authorizableCapabilityCount: number;
  readonly enabledCapabilityCount: number;
  readonly connectedAt: string | null;
  readonly lastSyncedAt: string | null;
  readonly logo: ConnectorCatalogEntry['logo'];
  readonly setup: ConnectorSetup;
  readonly isInstalled: boolean;
  readonly isConnected: boolean;
  readonly canConfigure: boolean;
  /** True when the provider publishes no API and setup is a guided upload. */
  readonly isManualOnly: boolean;
  readonly connectHref: string | null;
  readonly connectLabel: string | null;
};

export type IntegrationActivity = {
  readonly id: string;
  readonly providerName: string;
  readonly capability: string;
  readonly status: string;
  readonly trigger: string;
  readonly records: number;
  readonly createdAt: string;
};

function cardOf(
  entry: ConnectorCatalogEntry,
  registry: ConnectorRegistryRow | undefined,
  installation: ConnectorInstallationRow | undefined,
): ConnectorCard {
  const isManualOnly = entry.availability === 'manual-only';
  const status = normalizedStatus(installation?.status) ?? registryStatus(entry, registry);
  const isConnected = status === 'connected-healthy' || status === 'connected-degraded';
  return Object.freeze({
    id: entry.descriptor.id,
    displayName: entry.displayName,
    summary: entry.summary,
    category: entry.category,
    availability: entry.availability,
    status,
    statusLabel: STATUS_LABELS[status],
    accountLabel: installation?.external_account_label || null,
    capabilityCount: entry.descriptor.capabilities.length,
    authorizableCapabilityCount: entry.descriptor.capabilities.length,
    enabledCapabilityCount: installation?.enabled_capabilities.length ?? 0,
    connectedAt: installation?.connected_at ?? null,
    lastSyncedAt: installation?.last_synced_at ?? null,
    logo: entry.logo,
    setup: entry.setup,
    isInstalled: Boolean(installation),
    isConnected,
    isManualOnly,
    canConfigure: registryAllowsConfiguration(entry, registry),
    connectHref: null,
    connectLabel: null,
  });
}

/** Resolves the immutable catalog and tenant installation rows into safe UI cards. */
export function connectorCardsOf(
  registryRows: readonly ConnectorRegistryRow[],
  installationRows: readonly ConnectorInstallationRow[],
): readonly ConnectorCard[] {
  const registryByKey = new Map(registryRows.map((row) => [row.provider_key, row]));
  const installationByProvider = new Map(installationRows.map((row) => [row.provider_id, row]));
  return listConnectorCatalog().map((entry) => {
    const registry = registryByKey.get(entry.descriptor.id);
    return cardOf(entry, registry, registry ? installationByProvider.get(registry.id) : undefined);
  });
}

/** Returns the static catalog for visibility, with every setup action disabled. */
export function defaultConnectorCards(): readonly ConnectorCard[] {
  return connectorCardsOf([], []);
}

/** Removes stale or forged selections that have no configurable registry row. */
export function selectableConnectorIds(
  cards: readonly ConnectorCard[],
  selectedIds: readonly string[],
): readonly string[] {
  const configurable = new Set(cards.filter((card) => card.canConfigure).map((card) => card.id));
  return [...new Set(selectedIds)].filter((id) => configurable.has(id));
}

/** Builds tenant-scoped setup cards for the infrastructure-free HQ demo. */
export function demoConnectorCards(selectedIds: readonly string[]): readonly ConnectorCard[] {
  const selected = new Set(selectedIds);
  const registryRows = listConnectorCatalog().map((entry) => ({
    id: entry.descriptor.id,
    provider_key: entry.descriptor.id,
    availability: entry.availability,
    is_active: entry.availability !== 'coming-soon',
  }));
  const installationRows = registryRows.filter((row) => selected.has(row.provider_key)).map((row) => ({
    id: `demo-${row.id}`,
    provider_id: row.id,
    status: row.availability === 'manual-only' ? 'manual_import'
      : row.availability === 'provider-approval-required' ? 'provider_approval_required'
      : 'setup_required',
    external_account_label: '', enabled_capabilities: [], connected_at: null,
    last_synced_at: null, updated_at: new Date(0).toISOString(),
  }));
  return connectorCardsOf(registryRows, installationRows);
}

/** Returns cards for one contextual Integrations view. */
export function filterConnectorCards(
  cards: readonly ConnectorCard[],
  view: 'catalog' | 'connected' | 'health',
): readonly ConnectorCard[] {
  if (view === 'connected') return cards.filter((card) => card.isConnected);
  if (view === 'health') {
    return cards.filter((card) => card.isConnected || card.status === 'reauthorization-required');
  }
  return cards;
}
