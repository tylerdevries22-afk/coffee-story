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

/**
 * How each registry availability reads when the tenant has no installation yet.
 * `manual_only` resolves to `setup-required` because nothing has been imported:
 * `manual-import` is reserved for an installation that actually exists.
 */
const REGISTRY_STATUS: Readonly<Record<string, ConnectorInstallationStatus>> = {
  available: 'setup-required',
  setup_required: 'setup-required',
  provider_approval_required: 'provider-approval-required',
  manual_only: 'setup-required',
  uncertified: 'uncertified',
  coming_soon: 'uncertified',
  disabled: 'disabled',
};

const CONFIGURABLE_REGISTRY_AVAILABILITY = new Set([
  'available', 'setup_required', 'provider_approval_required',
]);

function normalizedAvailability(registry: ConnectorRegistryRow): string {
  return registry.availability.replaceAll('-', '_');
}

/**
 * True when the registry row and the code catalog agree that this provider has
 * no API. A disagreement is an operator error or a stale row, so it fails closed
 * rather than letting an OAuth provider inherit the manual-import treatment.
 */
function manualOnlyAgreed(
  entry: ConnectorCatalogEntry,
  registry: ConnectorRegistryRow,
): boolean {
  return normalizedAvailability(registry) === 'manual_only'
    && entry.availability === 'manual-only';
}

export function normalizedStatus(status: string | undefined): ConnectorInstallationStatus | undefined {
  if (!status) return undefined;
  const candidate = status.replaceAll('_', '-') as ConnectorInstallationStatus;
  return INSTALLATION_STATES.has(candidate) ? candidate : undefined;
}

/**
 * Resolves the status shown when the tenant has no installation row yet.
 *
 * The registry row is the authority, because it carries the operator's per-tenant
 * switch; the catalog only narrows it. An absent row, an inactive row, an
 * unrecognized availability, or a registry/catalog disagreement all read as
 * disabled so the card cannot advertise an action it should not have.
 */
export function registryStatus(
  entry: ConnectorCatalogEntry,
  registry: ConnectorRegistryRow | undefined,
): ConnectorInstallationStatus {
  if (entry.availability === 'coming-soon') return 'uncertified';
  if (!registry || !registry.is_active) return 'disabled';
  const availability = normalizedAvailability(registry);
  if (availability === 'manual_only' && !manualOnlyAgreed(entry, registry)) return 'disabled';
  return REGISTRY_STATUS[availability] ?? 'disabled';
}

/** True only when the registry permits setup and the catalog agrees on how. */
export function registryAllowsConfiguration(
  entry: ConnectorCatalogEntry,
  registry: ConnectorRegistryRow | undefined,
): boolean {
  if (!registry?.is_active) return false;
  if (entry.availability === 'coming-soon') return false;
  if (manualOnlyAgreed(entry, registry)) return true;
  if (entry.availability === 'manual-only') return false;
  return CONFIGURABLE_REGISTRY_AVAILABILITY.has(normalizedAvailability(registry));
}
