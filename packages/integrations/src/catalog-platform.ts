import { logo, oauthSetup, type CatalogDefinition } from './catalog-definition';

/** Infrastructure providers that report platform health. */
export const PLATFORM_DEFINITIONS: readonly CatalogDefinition[] = [
  {
    id: 'supabase', provider: 'Supabase', displayName: 'Supabase', category: 'platform',
    availability: 'available', authentication: 'oauth2',
    summary: 'Database, Auth, Storage, Realtime, migration, and security health.',
    capabilities: ['database.health', 'auth.health', 'storage.health', 'realtime.health', 'migrations.read', 'security-advisors.read'],
    mapping: ['organization', 'account'], health: ['auth', 'read', 'quota'],
    logo: logo('supabase', '#3FCF8E'),
    setup: oauthSetup({
      id: 'supabase',
      consoleUrl: 'https://supabase.com/dashboard/org/_/apps',
      documentationUrl: 'https://supabase.com/docs/guides/integrations/oauth-apps/authorize-an-oauth-app',
      credentialEnvKeys: ['SUPABASE_OAUTH_CLIENT_ID', 'SUPABASE_OAUTH_CLIENT_SECRET'],
      operatorSteps: [{ text: 'Grant only the project this organization owns.' }],
    }),
  },
  {
    id: 'vercel', provider: 'Vercel', displayName: 'Vercel', category: 'platform',
    availability: 'available', authentication: 'oauth2',
    summary: 'Deployment, domain, cron, workflow, environment, and runtime health.',
    capabilities: ['deployments.read', 'domains.read', 'cron.read', 'workflows.read', 'environment.read', 'runtime.health'],
    mapping: ['organization', 'account'], health: ['auth', 'read', 'webhook', 'quota'],
    logo: logo('vercel', '#000000'), webhooks: true,
    setup: oauthSetup({
      id: 'vercel',
      consoleUrl: 'https://vercel.com/account/tokens',
      documentationUrl: 'https://vercel.com/docs/integrations/create-integration',
      credentialEnvKeys: ['VERCEL_OAUTH_CLIENT_ID', 'VERCEL_OAUTH_CLIENT_SECRET'],
      operatorSteps: [{ text: 'Scope the install to the team that owns this deployment.' }],
    }),
  },
  {
    id: 'sentry', provider: 'Sentry', displayName: 'Sentry', category: 'platform',
    availability: 'available', authentication: 'oauth2',
    summary: 'Releases, error trends, affected apps, and unresolved production issues.',
    capabilities: ['releases.read', 'issues.read', 'trends.read'],
    mapping: ['organization', 'account'], health: ['auth', 'read', 'webhook', 'quota'],
    logo: logo('sentry', '#362D59'), webhooks: true,
    setup: oauthSetup({
      id: 'sentry',
      consoleUrl: 'https://sentry.io/settings/account/api/applications/',
      documentationUrl: 'https://docs.sentry.io/api/guides/create-auth-token/',
      credentialEnvKeys: ['SENTRY_OAUTH_CLIENT_ID', 'SENTRY_OAUTH_CLIENT_SECRET'],
      operatorSteps: [{ text: 'Pick the Sentry organization whose issues belong to this tenant.' }],
    }),
  },
] as const;
