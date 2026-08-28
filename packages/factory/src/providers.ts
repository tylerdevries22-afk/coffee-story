export const FACTORY_SURFACES = ['hq', 'display', 'customer', 'operator', 'kiosk'] as const;

export type FactorySurface = (typeof FACTORY_SURFACES)[number];

export interface VercelProjectSpecification {
  readonly name: string;
  readonly rootDirectory: string;
  readonly framework: 'nextjs' | null;
  readonly repository: string;
}

const PROJECT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requireSlug(value: string, label: string): string {
  if (!PROJECT_SLUG.test(value) || value.length > 63) {
    throw new Error(`${label} must be a lowercase hyphenated slug.`);
  }
  return value;
}

export function factoryResourceName(tenantSlug: string, suffix?: string): string {
  const tenant = requireSlug(tenantSlug, 'Tenant slug');
  return suffix ? `${tenant}-${requireSlug(suffix, 'Resource suffix')}` : tenant;
}

export function githubTemplateRequest(
  tenantSlug: string,
  repositoryOwner: string,
): Readonly<Record<string, unknown>> {
  if (!repositoryOwner.trim()) throw new Error('Repository owner is required.');
  return Object.freeze({
    owner: repositoryOwner.trim(),
    name: factoryResourceName(tenantSlug),
    description: `Generated application platform for ${tenantSlug}`,
    include_all_branches: false,
    private: true,
  });
}

export function dopplerProjectRequest(tenantSlug: string): Readonly<Record<string, string>> {
  return Object.freeze({
    name: factoryResourceName(tenantSlug),
    description: `Isolated runtime configuration for ${tenantSlug}`,
  });
}

export function supabaseProjectRequest(
  tenantSlug: string,
  organizationSlug: string,
  region: string,
  databasePassword: string,
): Readonly<Record<string, unknown>> {
  if (!organizationSlug.trim() || !region.trim() || databasePassword.length < 24) {
    throw new Error('Supabase organization, region, and a strong database password are required.');
  }
  return Object.freeze({
    name: factoryResourceName(tenantSlug),
    organization_slug: organizationSlug.trim(),
    region_selection: { type: 'specific', code: region.trim() },
    db_pass: databasePassword,
  });
}

export function vercelProjectSpecifications(
  tenantSlug: string,
  repository: string,
): readonly VercelProjectSpecification[] {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) throw new Error('GitHub repository must use owner/name format.');
  return FACTORY_SURFACES.map((surface) => ({
    name: factoryResourceName(tenantSlug, surface),
    rootDirectory: `apps/${surface}`,
    framework: surface === 'hq' || surface === 'display' ? 'nextjs' : null,
    repository,
  }));
}
