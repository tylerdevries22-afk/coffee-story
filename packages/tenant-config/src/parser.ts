import { parseLocations } from './parse-locations';
import {
  isRecord,
  parseInheritance,
  parseNetwork,
  parseOrganization,
  parseProviders,
  parseSurfaces,
} from './parse-metadata';
import { TENANT_SCHEMA_VERSION, type TenantManifest, type TenantManifestResult } from './types';

const TOP_LEVEL = new Set([
  '$docs', 'schemaVersion', 'organization', 'network', 'inheritance', 'surfaces', 'providers',
  'identity', 'tokens', 'copy', 'features', 'fees', 'tax', 'loyalty', 'board', 'location',
  'locations', 'illustrations', 'business', 'information', 'kiosk',
]);

function stringRecord(value: unknown, path: string, issues: string[]): Record<string, string> | null {
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'string')) {
    issues.push(`${path} must be an object of strings`);
    return null;
  }
  return value as Record<string, string>;
}

function booleanRecord(value: unknown, path: string, issues: string[]): Record<string, boolean> | null {
  if (!isRecord(value) || Object.values(value).some((entry) => typeof entry !== 'boolean')) {
    issues.push(`${path} must be an object of booleans`);
    return null;
  }
  return value as Record<string, boolean>;
}

function parseIdentity(value: unknown, issues: string[]): TenantManifest['identity'] | null {
  const keys = ['slug', 'name', 'bundleId', 'scheme', 'kioskBundleId', 'kioskScheme', 'easProjectId', 'kioskEasProjectId'];
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    issues.push(`identity must contain only ${keys.join(', ')}`);
    return null;
  }
  for (const key of keys) if (typeof value[key] !== 'string') issues.push(`identity.${key} must be a string`);
  return keys.every((key) => typeof value[key] === 'string')
    ? value as TenantManifest['identity'] : null;
}

function parseOptionalRecord<T>(value: unknown, path: string, issues: string[]): T | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return undefined;
  }
  return value as T;
}

function parseOptionalStringRecord(
  value: unknown, path: string, issues: string[],
): Record<string, string> | undefined {
  return value === undefined ? undefined : stringRecord(value, path, issues) ?? undefined;
}

function validateRelationships(
  organization: TenantManifest['organization'] | null,
  network: TenantManifest['network'],
  inheritance: TenantManifest['inheritance'] | null,
  issues: string[],
): void {
  if (!organization) return;
  const networkKind = organization.kind === 'franchisor' || organization.kind === 'franchisee';
  if (networkKind && !network) issues.push(`${organization.kind} organizations require network metadata`);
  if (!networkKind && network) issues.push(`${organization.kind} organizations must set network to null`);
  if (organization.kind === 'franchisor' && network?.relationship !== 'owner') issues.push('franchisors must own their network');
  if (organization.kind === 'franchisee' && network?.relationship !== 'member') issues.push('franchisees must be network members');
  if (inheritance?.mode === 'network' && inheritance.sourceTenantSlug === null) {
    issues.push('network inheritance requires a source tenant');
  }
  if (organization.kind === 'franchisee' && inheritance?.mode !== 'network') {
    issues.push('franchisees must declare network inheritance');
  }
}

/** Strictly validates a versioned tenant deployment manifest without throwing. */
export function parseTenantManifest(raw: unknown): TenantManifestResult {
  if (!isRecord(raw)) return { kind: 'invalid', issues: ['brand.json must contain one object'] };
  const issues: string[] = [];
  for (const key of Object.keys(raw)) if (!TOP_LEVEL.has(key)) issues.push(`unsupported top-level field "${key}"`);
  if (raw.schemaVersion !== TENANT_SCHEMA_VERSION) issues.push(`schemaVersion must equal ${TENANT_SCHEMA_VERSION}`);
  const organization = parseOrganization(raw.organization, issues);
  const network = parseNetwork(raw.network, issues);
  const inheritance = parseInheritance(raw.inheritance, issues);
  const surfaces = parseSurfaces(raw.surfaces, issues);
  const providers = parseProviders(raw.providers, issues);
  const identity = parseIdentity(raw.identity, issues);
  const tokens = parseOptionalRecord<Record<string, unknown>>(raw.tokens, 'tokens', issues);
  const copy = stringRecord(raw.copy, 'copy', issues);
  const features = booleanRecord(raw.features, 'features', issues);
  const { locations, legacyLocation } = parseLocations(raw, issues);
  const fees = parseOptionalRecord<TenantManifest['fees']>(raw.fees, 'fees', issues);
  const business = parseOptionalStringRecord(raw.business, 'business', issues);
  const tax = parseOptionalRecord<TenantManifest['tax']>(raw.tax, 'tax', issues);
  const loyalty = parseOptionalRecord<TenantManifest['loyalty']>(raw.loyalty, 'loyalty', issues);
  const board = parseOptionalRecord<Record<string, unknown>>(raw.board, 'board', issues);
  const kiosk = parseOptionalRecord<Record<string, unknown>>(raw.kiosk, 'kiosk', issues);
  validateRelationships(organization, network, inheritance, issues);
  if (issues.length > 0 || !organization || !inheritance || !identity || !tokens || !copy || !features) {
    return { kind: 'invalid', issues };
  }
  return { kind: 'ok', manifest: {
    schemaVersion: TENANT_SCHEMA_VERSION, organization, network, inheritance, surfaces, providers,
    identity, tokens, copy, features, locations, legacyLocation, raw,
    fees, business, tax, loyalty, board, kiosk,
  } };
}
