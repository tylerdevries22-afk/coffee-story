import type { SupabaseClient } from '@supabase/supabase-js';
import {
  factoryTasks,
  type FactoryRunState,
  type FactoryStage,
  type FactoryTaskState,
} from '@platform/factory';

type RunRow = {
  id: string;
  business_name: string;
  tenant_slug: string;
  state: FactoryRunState;
  stage: FactoryStage;
  created_at: string;
};

type TaskRow = {
  run_id: string;
  task_key: string;
  state: FactoryTaskState;
  attempt_count: number;
};

type CredentialRow = { run_id: string; state: string };

type ProviderGuideRow = {
  provider: string;
  title: string;
  owner_role: 'platform' | 'client' | 'account_holder';
  official_url: string;
  steps: unknown;
  last_verified_at: string;
};

export type ProviderGuideView = {
  provider: string;
  title: string;
  ownerRole: ProviderGuideRow['owner_role'];
  officialUrl: string;
  steps: readonly string[];
  lastVerifiedAt: string;
};

export type FactoryRunView = {
  id: string;
  businessName: string;
  tenantSlug: string;
  state: FactoryRunState;
  stage: FactoryStage;
  completedTasks: number;
  totalTasks: number;
  verifiedCredentials: number;
  requiredCredentials: number;
  createdAt: string;
};

export type FactoryOverview = {
  source: 'demo' | 'hosted' | 'unavailable';
  runs: readonly FactoryRunView[];
  guides: readonly ProviderGuideView[];
  issue?: string;
};

const DEMO_RUNS: readonly FactoryRunView[] = [
  {
    id: 'demo-coffee-story',
    businessName: 'Coffee Story',
    tenantSlug: 'coffee-story',
    state: 'live',
    stage: 'live',
    completedTasks: 11,
    totalTasks: 11,
    verifiedCredentials: 4,
    requiredCredentials: 4,
    createdAt: '2026-08-26T16:00:00.000Z',
  },
  {
    id: 'demo-juniper',
    businessName: 'Juniper Coffee',
    tenantSlug: 'juniper-coffee',
    state: 'blocked',
    stage: 'credentials',
    completedTasks: 3,
    totalTasks: 11,
    verifiedCredentials: 1,
    requiredCredentials: 4,
    createdAt: '2026-08-27T15:20:00.000Z',
  },
];

const DEMO_GUIDES: readonly ProviderGuideView[] = [
  { provider: 'github', title: 'Install the repository factory', ownerRole: 'platform', officialUrl: 'https://docs.github.com/en/apps/using-github-apps/about-using-github-apps', steps: ['Install the least-privilege GitHub App.', 'Choose the template organization.', 'Verify repository creation access.'], lastVerifiedAt: '2026-08-27' },
  { provider: 'doppler', title: 'Create scoped secret environments', ownerRole: 'platform', officialUrl: 'https://docs.doppler.com/docs/service-tokens', steps: ['Create the platform-factory project.', 'Add dev, preview, and production configs.', 'Issue one read-only token per runtime.'], lastVerifiedAt: '2026-08-27' },
  { provider: 'supabase', title: 'Authorize hosted project creation', ownerRole: 'platform', officialUrl: 'https://supabase.com/docs/reference/api/getting-started', steps: ['Create a scoped Management API token.', 'Choose the organization and region.', 'Verify project and API-key access.'], lastVerifiedAt: '2026-08-27' },
  { provider: 'vercel', title: 'Authorize five hosted surfaces', ownerRole: 'platform', officialUrl: 'https://vercel.com/docs/rest-api', steps: ['Create a team access token.', 'Choose the owning team.', 'Verify project and environment access.'], lastVerifiedAt: '2026-08-27' },
  { provider: 'apple', title: 'Connect the client Apple team', ownerRole: 'account_holder', officialUrl: 'https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api', steps: ['Enroll the client organization.', 'Invite the release operator.', 'Create an App Store Connect API key.'], lastVerifiedAt: '2026-08-27' },
  { provider: 'google-play', title: 'Connect the client Play Console', ownerRole: 'account_holder', officialUrl: 'https://developers.google.com/android-publisher/getting_started', steps: ['Create the organization developer account.', 'Enable the publishing API.', 'Grant a scoped service account app access.'], lastVerifiedAt: '2026-08-27' },
  { provider: 'expo', title: 'Configure managed build credentials', ownerRole: 'client', officialUrl: 'https://docs.expo.dev/app-signing/security/', steps: ['Create or join the client Expo organization.', 'Initialize the customer and kiosk projects.', 'Use managed credentials and verify store submission access.'], lastVerifiedAt: '2026-08-27' },
];

export function providerGuideViews(rows: readonly ProviderGuideRow[]): readonly ProviderGuideView[] {
  return rows.flatMap((row) => {
    if (!Array.isArray(row.steps) || !row.steps.every((step) => typeof step === 'string')) return [];
    return [{ provider: row.provider, title: row.title, ownerRole: row.owner_role, officialUrl: row.official_url, steps: row.steps, lastVerifiedAt: row.last_verified_at }];
  });
}

export function factoryRunViews(
  runs: readonly RunRow[],
  tasks: readonly TaskRow[],
  credentials: readonly CredentialRow[],
): readonly FactoryRunView[] {
  return runs.map((run) => {
    const runTasks = tasks.filter((task) => task.run_id === run.id);
    const runCredentials = credentials.filter((credential) => credential.run_id === run.id);
    return {
      id: run.id,
      businessName: run.business_name,
      tenantSlug: run.tenant_slug,
      state: run.state,
      stage: run.stage,
      completedTasks: runTasks.filter((task) => task.state === 'completed').length,
      totalTasks: runTasks.length || factoryTasks().length,
      verifiedCredentials: runCredentials.filter((credential) => credential.state === 'verified').length,
      requiredCredentials: runCredentials.length,
      createdAt: run.created_at,
    };
  });
}

export async function loadFactoryOverview(client: SupabaseClient | null): Promise<FactoryOverview> {
  if (!client) return { source: 'demo', runs: DEMO_RUNS, guides: DEMO_GUIDES };
  const [runs, tasks, credentials, guides] = await Promise.all([
    client.from('platform_onboarding_runs')
      .select('id, business_name, tenant_slug, state, stage, created_at')
      .order('created_at', { ascending: false }).limit(50).returns<RunRow[]>(),
    client.from('platform_onboarding_tasks')
      .select('run_id, task_key, state, attempt_count').returns<TaskRow[]>(),
    client.from('platform_credential_requirements')
      .select('run_id, state').returns<CredentialRow[]>(),
    client.from('platform_provider_guides')
      .select('provider, title, owner_role, official_url, steps, last_verified_at')
      .eq('status', 'active').order('provider').returns<ProviderGuideRow[]>(),
  ]);
  if (runs.error || tasks.error || credentials.error || guides.error) {
    return { source: 'unavailable', runs: [], guides: DEMO_GUIDES, issue: 'The hosted factory schema is not available yet.' };
  }
  return { source: 'hosted', runs: factoryRunViews(runs.data ?? [], tasks.data ?? [], credentials.data ?? []), guides: providerGuideViews(guides.data ?? []) };
}
