import {
  listConnectorCatalog,
  type ConnectorAvailability,
  type ConnectorCatalogEntry,
  type ConnectorCategory,
  type ConnectorInstallationStatus,
} from '@platform/integrations';

export type ConnectorRegistryRow = {
  readonly id: string;
  readonly provider_key: string;
  readonly availability: string;
  readonly is_active: boolean;
};

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
  readonly enabledCapabilityCount: number;
  readonly connectedAt: string | null;
  readonly lastSyncedAt: string | null;
  readonly logo: ConnectorCatalogEntry['logo'];
  readonly isInstalled: boolean;
  readonly isConnected: boolean;
  readonly canConfigure: boolean;
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

const INSTALLATION_STATES = new Set<ConnectorInstallationStatus>([
  'available',
  'setup-required',
  'provider-approval-required',
  'connecting',
  'connected-healthy',
  'connected-degraded',
  'reauthorization-required',
  'disabled',
  'revoked',
  'uncertified',
]);

const STATUS_LABELS: Readonly<Record<ConnectorInstallationStatus, string>> = {
  available: 'Available',
  'setup-required': 'Setup required',
  'provider-approval-required': 'Provider approval required',
  connecting: 'Connecting',
  'connected-healthy': 'Connected and healthy',
  'connected-degraded': 'Connected but degraded',
  'reauthorization-required': 'Reauthorization required',
  disabled: 'Disabled',
  revoked: 'Revoked',
  uncertified: 'Uncertified',
};

const CONFIGURABLE_REGISTRY_AVAILABILITY = new Set([
  'available', 'setup_required', 'provider_approval_required',
]);

function normalizedStatus(status: string | undefined): ConnectorInstallationStatus | undefined {
  if (!status) return undefined;
  const candidate = status.replaceAll('_', '-') as ConnectorInstallationStatus;
  return INSTALLATION_STATES.has(candidate) ? candidate : undefined;
}

function fallbackStatus(entry: ConnectorCatalogEntry): ConnectorInstallationStatus {
  if (entry.availability === 'provider-approval-required') return 'provider-approval-required';
  if (entry.availability === 'coming-soon') return 'uncertified';
  return 'setup-required';
}

function registryStatus(
  entry: ConnectorCatalogEntry,
  registry: ConnectorRegistryRow | undefined,
): ConnectorInstallationStatus {
  if (!registry) return 'disabled';
  const availability = registry.availability.replaceAll('-', '_');
  if (availability === 'coming_soon' || availability === 'uncertified') {
    return 'uncertified';
  }
  if (!registry.is_active || availability === 'disabled') return 'disabled';
  return fallbackStatus(entry);
}

function registryAllowsConfiguration(registry: ConnectorRegistryRow | undefined): boolean {
  if (!registry?.is_active) return false;
  return CONFIGURABLE_REGISTRY_AVAILABILITY.has(registry.availability.replaceAll('-', '_'));
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
    const installation = registry ? installationByProvider.get(registry.id) : undefined;
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
      enabledCapabilityCount: installation?.enabled_capabilities.length ?? 0,
      connectedAt: installation?.connected_at ?? null,
      lastSyncedAt: installation?.last_synced_at ?? null,
      logo: entry.logo,
      isInstalled: Boolean(installation),
      isConnected,
      canConfigure: entry.availability !== 'coming-soon'
        && registryAllowsConfiguration(registry),
      connectHref: null,
      connectLabel: null,
    });
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
    status: row.availability === 'provider-approval-required'
      ? 'provider_approval_required' : 'setup_required',
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
