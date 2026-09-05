import type { SafeResource } from './factory-runtime';

type DopplerExpectation = { project: string };
type SupabaseExpectation = { project: string; region: string; organizationSlug: string };

const SUPABASE_USABLE = new Set(['ACTIVE_HEALTHY', 'COMING_UP', 'CREATING_PROJECT']);
const SUPABASE_REFERENCE = /^[a-z0-9]{20}$/;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function supabaseProjectFromLookup(value: unknown, name: string): unknown | null {
  const envelope = object(value);
  const projects = Array.isArray(value)
    ? value : Array.isArray(envelope?.projects) ? envelope.projects : null;
  if (!projects) throw new Error('Supabase project lookup returned an invalid response.');
  return projects.find((project) => object(project)?.name === name) ?? null;
}

function assertStored(
  stored: SafeResource,
  expected: SafeResource,
): void {
  const metadata = object(stored.metadata);
  const expectedMetadata = object(expected.metadata);
  const matches = stored.provider === expected.provider && stored.kind === expected.kind
    && stored.environment === 'production' && stored.externalId === expected.externalId
    && stored.displayName === expected.displayName && metadata && expectedMetadata
    && Object.entries(expectedMetadata).every(([key, value]) => metadata[key] === value);
  if (!matches) throw new Error(`Stored ${expected.provider} resource provenance does not match.`);
}

export function verifiedDopplerResource(
  value: unknown,
  expected: DopplerExpectation,
  stored: SafeResource | null,
): SafeResource {
  const payload = object(value);
  const providerId = text(payload?.id);
  const name = text(payload?.name);
  if (!payload || !providerId || name !== expected.project) {
    throw new Error('Doppler project identity does not match the requested tenant.');
  }
  const resource: SafeResource = {
    provider: 'doppler', kind: 'project', environment: 'production',
    externalId: providerId, displayName: name,
    metadata: { project: expected.project, providerId },
  };
  if (stored) assertStored(stored, resource);
  return resource;
}

export function verifiedSupabaseResource(
  value: unknown,
  expected: SupabaseExpectation,
  stored: SafeResource | null,
): SafeResource {
  const payload = object(value);
  const reference = text(payload?.ref);
  const name = text(payload?.name);
  const region = text(payload?.region);
  const status = text(payload?.status);
  const organizationSlug = text(payload?.organization_slug);
  if (!payload || !reference || !SUPABASE_REFERENCE.test(reference)
    || name !== expected.project || region !== expected.region
    || !status || !SUPABASE_USABLE.has(status) || payload.is_branch === true
    || (organizationSlug && organizationSlug !== expected.organizationSlug)) {
    throw new Error('Supabase project provenance or status does not match the requested tenant.');
  }
  const resource: SafeResource = {
    provider: 'supabase', kind: 'project', environment: 'production',
    externalId: reference, displayName: name,
    metadata: { region: expected.region, organizationSlug: expected.organizationSlug, status },
  };
  if (stored) assertStored(stored, {
    ...resource,
    metadata: { region: expected.region, organizationSlug: expected.organizationSlug },
  });
  return resource;
}
