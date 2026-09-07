import type {
  ConnectorCatalogEntry,
  ConnectorInstallationStatus,
} from '@platform/integrations';

export type ConnectorRegistryRow = {
  readonly id: string;
  readonly provider_key: string;
  readonly availability: string;
  readonly is_active: boolean;
};

const INSTALLATION_STATES = new Set<ConnectorInstallationStatus>([
  'available', 'setup-required', 'provider-approval-required', 'connecting',
  'connected-healthy', 'connected-degraded', 'reauthorization-required',
  'disabled', 'revoked', 'uncertified', 'manual-import',
]);

export const STATUS_LABELS: Readonly<Record<ConnectorInstallationStatus, string>> = {
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
  'manual-import': 'Manual import',
};

const CONFIGURABLE_REGISTRY_AVAILABILITY = new Set([
  'available', 'setup_required', 'provider_approval_required', 'manual_only',
]);

export function normalizedStatus(status: string | undefined): ConnectorInstallationStatus | undefined {
  if (!status) return undefined;
  const candidate = status.replaceAll('_', '-') as ConnectorInstallationStatus;
  return INSTALLATION_STATES.has(candidate) ? candidate : undefined;
}

function fallbackStatus(entry: ConnectorCatalogEntry): ConnectorInstallationStatus {
  if (entry.availability === 'manual-only') return 'manual-import';
  if (entry.availability === 'provider-approval-required') return 'provider-approval-required';
  if (entry.availability === 'coming-soon') return 'uncertified';
  return 'setup-required';
}

/**
 * Resolves the status shown when the tenant has no installation row yet. With no
 * registry row at all the catalog is being rendered fail-closed, so every
 * provider reads as disabled regardless of how it would otherwise be set up.
 */
export function registryStatus(
  entry: ConnectorCatalogEntry,
  registry: ConnectorRegistryRow | undefined,
): ConnectorInstallationStatus {
  if (!registry) return 'disabled';
  const availability = registry.availability.replaceAll('-', '_');
  if (availability === 'coming_soon' || availability === 'uncertified') return 'uncertified';
  if (!registry.is_active || availability === 'disabled') return 'disabled';
  return fallbackStatus(entry);
}

export function registryAllowsConfiguration(registry: ConnectorRegistryRow | undefined): boolean {
  if (!registry?.is_active) return false;
  return CONFIGURABLE_REGISTRY_AVAILABILITY.has(registry.availability.replaceAll('-', '_'));
}
