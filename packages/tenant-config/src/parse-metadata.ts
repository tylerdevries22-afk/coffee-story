import {
  ORGANIZATION_KINDS,
  TENANT_SURFACES,
  type TenantInheritance,
  type TenantNetwork,
  type TenantProvider,
  type TenantSurface,
} from './types';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseOrganization(value: unknown, issues: string[]): { kind: typeof ORGANIZATION_KINDS[number] } | null {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'kind')) {
    issues.push('organization must contain only kind');
    return null;
  }
  if (!(ORGANIZATION_KINDS as readonly unknown[]).includes(value.kind)) {
    issues.push(`organization.kind must be one of ${ORGANIZATION_KINDS.join(', ')}`);
    return null;
  }
  return { kind: value.kind as typeof ORGANIZATION_KINDS[number] };
}

export function parseNetwork(value: unknown, issues: string[]): TenantNetwork | null {
  if (value === null) return null;
  if (!isRecord(value) || Object.keys(value).some((key) => !['slug', 'relationship'].includes(key))) {
    issues.push('network must be null or contain only slug and relationship');
    return null;
  }
  if (typeof value.slug !== 'string' || !SLUG.test(value.slug)) issues.push('network.slug must be kebab-case');
  if (value.relationship !== 'owner' && value.relationship !== 'member') {
    issues.push('network.relationship must be owner or member');
  }
  return typeof value.slug === 'string' && SLUG.test(value.slug)
    && (value.relationship === 'owner' || value.relationship === 'member')
    ? { slug: value.slug, relationship: value.relationship }
    : null;
}

export function parseInheritance(value: unknown, issues: string[]): TenantInheritance | null {
  if (!isRecord(value) || Object.keys(value).some(
    (key) => !['mode', 'sourceTenantSlug', 'revision', 'overrides'].includes(key),
  )) {
    issues.push('inheritance must contain only mode, sourceTenantSlug, revision, and overrides');
    return null;
  }
  const mode = value.mode;
  const source = value.sourceTenantSlug;
  const revision = value.revision;
  const overrides = value.overrides;
  if (mode !== 'standalone' && mode !== 'network') issues.push('inheritance.mode must be standalone or network');
  if (source !== null && (typeof source !== 'string' || !SLUG.test(source))) {
    issues.push('inheritance.sourceTenantSlug must be null or kebab-case');
  }
  if (!Number.isInteger(revision) || Number(revision) < 1) issues.push('inheritance.revision must be a positive integer');
  if (!Array.isArray(overrides) || overrides.some((path) => typeof path !== 'string' || path.length === 0)) {
    issues.push('inheritance.overrides must be a list of non-empty paths');
  } else if (new Set(overrides).size !== overrides.length) issues.push('inheritance.overrides must not repeat paths');
  if (mode === 'standalone' && source !== null) issues.push('standalone inheritance must have a null sourceTenantSlug');
  if (mode === 'network' && typeof source !== 'string') issues.push('network inheritance requires sourceTenantSlug');
  if ((mode !== 'standalone' && mode !== 'network') || !Number.isInteger(revision) || !Array.isArray(overrides)) return null;
  return { mode, sourceTenantSlug: typeof source === 'string' ? source : null, revision: Number(revision), overrides } as TenantInheritance;
}

export function parseSurfaces(value: unknown, issues: string[]): TenantSurface[] {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push('surfaces must be a non-empty list');
    return [];
  }
  const surfaces = value.filter((entry): entry is TenantSurface =>
    typeof entry === 'string' && (TENANT_SURFACES as readonly string[]).includes(entry));
  if (surfaces.length !== value.length) issues.push(`surfaces entries must be one of ${TENANT_SURFACES.join(', ')}`);
  if (new Set(surfaces).size !== surfaces.length) issues.push('surfaces must not repeat entries');
  return surfaces;
}

export function parseProviders(value: unknown, issues: string[]): TenantProvider[] {
  if (!Array.isArray(value)) {
    issues.push('providers must be a list');
    return [];
  }
  const providers: TenantProvider[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    const path = `providers[${index}]`;
    if (!isRecord(entry) || Object.keys(entry).some(
      (key) => !['capability', 'provider', 'ownership', 'required'].includes(key),
    )) {
      issues.push(`${path} must contain only capability, provider, ownership, and required`);
      return;
    }
    if (typeof entry.capability !== 'string' || !SLUG.test(entry.capability)) issues.push(`${path}.capability must be kebab-case`);
    if (typeof entry.provider !== 'string' || !SLUG.test(entry.provider)) issues.push(`${path}.provider must be kebab-case`);
    if (!['platform', 'organization', 'franchisor'].includes(String(entry.ownership))) issues.push(`${path}.ownership is invalid`);
    if (typeof entry.required !== 'boolean') issues.push(`${path}.required must be a boolean`);
    if (typeof entry.capability !== 'string' || seen.has(entry.capability)) issues.push(`${path}.capability must be unique`);
    else seen.add(entry.capability);
    if (typeof entry.capability === 'string' && typeof entry.provider === 'string'
      && ['platform', 'organization', 'franchisor'].includes(String(entry.ownership))
      && typeof entry.required === 'boolean') {
      providers.push(entry as TenantProvider);
    }
  });
  return providers;
}
