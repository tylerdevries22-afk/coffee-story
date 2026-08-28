import {
  FACTORY_SCHEMA_VERSION,
  type FactoryTaskDefinition,
  type FactoryTaskSnapshot,
  type IndustryBlueprint,
  type OnboardingIntake,
  type ProvisioningPlan,
  type ValidationResult,
} from './contracts';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IANA_ZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/;

const TASKS = [
  task('research-brand', 'Research brand and source assets', 'intake', 'research'),
  task('generate-demo', 'Generate the five-app demo', 'demo', 'platform', ['research-brand']),
  task('verify-demo', 'Verify cross-app demo behavior', 'demo', 'platform', ['generate-demo']),
  task('collect-credentials', 'Verify required provider access', 'credentials', 'platform', ['verify-demo']),
  task('create-github-repository', 'Create the industry repository', 'infrastructure', 'github', ['collect-credentials'], ['github.app']),
  task('create-doppler-project', 'Create scoped secret environments', 'infrastructure', 'doppler', ['create-github-repository'], ['doppler.service_token']),
  task('create-supabase-project', 'Create the hosted data project', 'infrastructure', 'supabase', ['create-doppler-project'], ['supabase.management_token']),
  task('create-vercel-projects', 'Create and configure five Vercel projects', 'infrastructure', 'vercel', ['create-supabase-project'], ['vercel.token']),
  task('publish-content', 'Publish the validated catalog and training release', 'content', 'platform', ['create-vercel-projects']),
  task('verify-canary', 'Verify the hosted canary release', 'canary', 'vercel', ['publish-content']),
  task('promote-live', 'Promote the verified release', 'live', 'vercel', ['verify-canary']),
] as const satisfies readonly FactoryTaskDefinition[];

function task(
  key: string,
  label: string,
  stage: FactoryTaskDefinition['stage'],
  provider: FactoryTaskDefinition['provider'],
  dependsOn: readonly string[] = [],
  credentialKeys: readonly string[] = [],
): FactoryTaskDefinition {
  return { key, label, stage, provider, dependsOn, credentialKeys, timeoutMs: 30_000, maximumAttempts: 2 };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalHttpsUrl(value: unknown, issues: string[]): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // The common issue below is intentionally user-safe and stable.
  }
  issues.push('Website URL must use HTTPS.');
  return undefined;
}

export function parseOnboardingIntake(value: unknown): ValidationResult<OnboardingIntake> {
  if (!value || typeof value !== 'object') return { ok: false, issues: ['Onboarding input is required.'] };
  const row = value as Record<string, unknown>;
  const businessName = stringValue(row.businessName);
  const tenantSlug = stringValue(row.tenantSlug);
  const industryKey = stringValue(row.industryKey);
  const locationName = stringValue(row.locationName);
  const timezone = stringValue(row.timezone);
  const issues: string[] = [];
  if (businessName.length < 2 || businessName.length > 120) issues.push('Business name must be 2 to 120 characters.');
  if (!SLUG.test(tenantSlug) || tenantSlug.length > 63) issues.push('Tenant slug must be lowercase words separated by hyphens.');
  if (!SLUG.test(industryKey) || industryKey.length > 63) issues.push('Industry key must be a valid slug.');
  if (locationName.length < 2 || locationName.length > 120) issues.push('Location name must be 2 to 120 characters.');
  if (!IANA_ZONE.test(timezone)) issues.push('Timezone must be an IANA timezone such as America/Denver.');
  const websiteUrl = optionalHttpsUrl(row.websiteUrl, issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { businessName, tenantSlug, industryKey, locationName, timezone, ...(websiteUrl ? { websiteUrl } : {}) } };
}

export function validateIndustryBlueprint(value: IndustryBlueprint): ValidationResult<IndustryBlueprint> {
  const issues: string[] = [];
  if (value.schemaVersion !== FACTORY_SCHEMA_VERSION) issues.push('Industry blueprint schema version is not supported.');
  if (!SLUG.test(value.key)) issues.push('Industry blueprint key must be a valid slug.');
  if (!value.name.trim()) issues.push('Industry blueprint name is required.');
  if (!Number.isInteger(value.templateVersion) || value.templateVersion < 1) issues.push('Template version must be a positive integer.');
  if (!value.locale.trim() || !value.supabaseRegion.trim()) issues.push('Locale and Supabase region are required.');
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value };
}

export function createProvisioningPlan(
  blueprint: IndustryBlueprint,
  intake: OnboardingIntake,
): ProvisioningPlan {
  const valid = validateIndustryBlueprint(blueprint);
  if (!valid.ok) throw new Error(valid.issues.join(' '));
  if (blueprint.key !== intake.industryKey) throw new Error('Industry blueprint does not match onboarding intake.');
  return Object.freeze({ schemaVersion: FACTORY_SCHEMA_VERSION, industryKey: blueprint.key, tenantSlug: intake.tenantSlug, tasks: TASKS });
}

export function runnableTaskKeys(
  plan: ProvisioningPlan,
  snapshots: readonly FactoryTaskSnapshot[],
): readonly string[] {
  const states = new Map(snapshots.map((snapshot) => [snapshot.key, snapshot.state]));
  return plan.tasks
    .filter((candidate) => states.get(candidate.key) === 'pending')
    .filter((candidate) => candidate.dependsOn.every((dependency) => states.get(dependency) === 'completed'))
    .map((candidate) => candidate.key);
}

export function factoryTasks(): readonly FactoryTaskDefinition[] {
  return TASKS;
}
