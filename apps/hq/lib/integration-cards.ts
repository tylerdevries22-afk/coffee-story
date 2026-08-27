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
  readonly isConnected: boolean;
  readonly canConfigure: boolean;
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
    const status = normalizedStatus(installation?.status) ?? fallbackStatus(entry);
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
      isConnected,
      canConfigure: entry.availability !== 'coming-soon' && registry?.is_active !== false,
    });
  });
}

/** Returns the catalog with truthful setup states before tenant rows exist. */
export function defaultConnectorCards(): readonly ConnectorCard[] {
  return connectorCardsOf([], []);
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
