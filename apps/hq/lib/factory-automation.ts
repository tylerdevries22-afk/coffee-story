export type FactoryAutomationEnvironment = Readonly<Record<string, string | undefined>>;

export type BrandResearchArtifact = {
  summary: string;
  logoSourceUrl?: string;
  colors: readonly string[];
  sources: readonly { title: string; url: string }[];
};

export type FactoryRunInput = {
  businessName: string;
  tenantSlug: string;
  industryKey: string;
  locationName: string;
  websiteUrl?: string;
  surfaces: readonly import('@platform/factory').FactorySurface[];
};

const HTTPS = /^https:\/\//;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const REQUIRED_ENV: Readonly<Record<string, readonly string[]>> = {
  'openai.api_key': ['OPENAI_API_KEY', 'OPENAI_RESEARCH_MODEL'],
  'github.app': [
    'GITHUB_APP_ID',
    'GITHUB_APP_INSTALLATION_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_REPOSITORY_OWNER',
    'GITHUB_TEMPLATE_OWNER',
    'GITHUB_TEMPLATE_REPOSITORY',
  ],
  'doppler.service_token': ['DOPPLER_SERVICE_ACCOUNT_TOKEN', 'DOPPLER_WORKPLACE_SLUG'],
  'supabase.management_token': ['SUPABASE_MANAGEMENT_TOKEN', 'SUPABASE_ORGANIZATION_SLUG'],
  'vercel.token': ['VERCEL_TOKEN', 'VERCEL_SCOPE'],
};

function isNonEmpty(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function availableFactoryCredentialKeys(environment: FactoryAutomationEnvironment): readonly string[] {
  return Object.entries(REQUIRED_ENV)
    .filter(([, names]) => names.every((name) => isNonEmpty(environment[name])))
    .map(([key]) => key);
}

export function parseBrandResearchArtifact(value: unknown): BrandResearchArtifact | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.summary !== 'string' || row.summary.trim().length < 20 || row.summary.length > 2_000) return null;
  if (!Array.isArray(row.colors) || row.colors.length < 2 || row.colors.length > 8
    || !row.colors.every((color) => typeof color === 'string' && HEX_COLOR.test(color))) return null;
  if (!Array.isArray(row.sources) || row.sources.length < 1 || row.sources.length > 12) return null;
  const sources = row.sources.flatMap((source) => {
    if (!source || typeof source !== 'object') return [];
    const candidate = source as Record<string, unknown>;
    return typeof candidate.title === 'string' && candidate.title.trim()
      && typeof candidate.url === 'string' && HTTPS.test(candidate.url)
      ? [{ title: candidate.title.trim(), url: candidate.url }]
      : [];
  });
  if (sources.length !== row.sources.length) return null;
  const logoSourceUrl = typeof row.logoSourceUrl === 'string' && HTTPS.test(row.logoSourceUrl)
    ? row.logoSourceUrl
    : undefined;
  return { summary: row.summary.trim(), colors: row.colors.map((color) => color.toUpperCase()), sources, ...(logoSourceUrl ? { logoSourceUrl } : {}) };
}

export function buildFactoryApplicationManifest(
  run: FactoryRunInput,
  research: BrandResearchArtifact,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schemaVersion: 1,
    tenant: { slug: run.tenantSlug, businessName: run.businessName, industryKey: run.industryKey, locationName: run.locationName, ...(run.websiteUrl ? { websiteUrl: run.websiteUrl } : {}) },
    brandKit: { summary: research.summary, colors: research.colors, logoSourceUrl: research.logoSourceUrl ?? null },
    surfaces: run.surfaces,
    deployments: run.surfaces.map((surface) => ({
      surface,
      web: true,
      native: surface === 'customer' || surface === 'operator' || surface === 'kiosk',
    })),
    releasePolicy: { publishMode: 'atomic', failClosed: true, fallback: 'last_valid_release' },
  });
}
