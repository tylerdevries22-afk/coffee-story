import {
  APP_ZAP_CONNECTOR_SCHEMA,
  type ConnectorAuthentication,
  type ConnectorAvailability,
  type ConnectorCapabilityDescriptor,
  type ConnectorCatalogEntry,
  type ConnectorCategory,
  type ConnectorHealthDimension,
  type ConnectorLogo,
  type ConnectorMapping,
} from './contracts';

const API_VERSION = '2026-08-27';
const SIMPLE_ICONS = 'https://simpleicons.org';

interface CatalogDefinition {
  readonly id: string;
  readonly provider: string;
  readonly displayName: string;
  readonly summary: string;
  readonly category: ConnectorCategory;
  readonly availability: ConnectorAvailability;
  readonly authentication: ConnectorAuthentication;
  readonly capabilities: readonly string[];
  readonly mapping: readonly ConnectorMapping[];
  readonly health: readonly ConnectorHealthDimension[];
  readonly logo: ConnectorLogo;
  readonly webhooks?: boolean;
}

function capability(id: string, available: boolean): ConnectorCapabilityDescriptor {
  return {
    id,
    idempotency: available,
    reconciliation: available,
    sandbox: available,
  };
}

function logo(
  slug: string,
  brandColor: `#${string}`,
  monochromeTreatment: ConnectorLogo['monochromeTreatment'] = 'allowed',
): ConnectorLogo {
  return {
    brandColor,
    license: 'CC0-1.0',
    attribution: 'Simple Icons contributors',
    verifiedAt: '2026-08-27',
    monochromeTreatment,
    simpleIconsSlug: slug,
    sourceUrl: `${SIMPLE_ICONS}/?q=${encodeURIComponent(slug)}`,
  };
}

function entry(definition: CatalogDefinition): ConnectorCatalogEntry {
  const implemented = definition.availability !== 'coming-soon';
  return Object.freeze({
    availability: definition.availability,
    category: definition.category,
    descriptor: Object.freeze({
      $schema: APP_ZAP_CONNECTOR_SCHEMA,
      apiVersion: API_VERSION,
      authentication: definition.authentication,
      capabilities: Object.freeze(
        definition.capabilities.map((id) => Object.freeze(capability(id, implemented))),
      ),
      certification: Object.freeze({ evidenceIds: Object.freeze([]), state: 'uncertified' as const }),
      credentialOwnership: 'client' as const,
      health: Object.freeze([...definition.health]),
      id: definition.id,
      mapping: Object.freeze([...definition.mapping]),
      provider: definition.provider,
      resilience: Object.freeze({
        circuitBreaker: true as const,
        killSwitch: true as const,
        maximumAttempts: 2,
        timeoutMs: 10_000,
      }),
      webhooks: Object.freeze({
        deadLetters: true,
        inbox: true,
        replayProtection: true,
        signatureVerification: definition.webhooks ?? false,
      }),
    }),
    displayName: definition.displayName,
    logo: Object.freeze(definition.logo),
    summary: definition.summary,
  });
}

const DEFINITIONS: readonly CatalogDefinition[] = [
  {
    id: 'google-suite', provider: 'Google', displayName: 'Google', category: 'marketing',
    availability: 'provider-approval-required', authentication: 'oauth2',
    summary: 'Business Profile, Gmail, Drive, Calendar, Analytics, and Ads.',
    capabilities: ['business-profile.performance', 'business-profile.reviews', 'business-profile.locations', 'gmail.send-reviewed', 'drive.import', 'drive.export', 'calendar.read', 'calendar.write', 'ga4.reporting', 'google-ads.reporting'],
    mapping: ['organization', 'account', 'location'], health: ['auth', 'read', 'write', 'quota', 'reconciliation'],
    logo: logo('google', '#4285F4', 'retain-official-mark'), webhooks: true,
  },
  {
    id: 'square', provider: 'Square', displayName: 'Square', category: 'commerce', availability: 'available', authentication: 'oauth2',
    summary: 'Location payments, orders, catalog, refunds, and reconciliation.',
    capabilities: ['payments.read', 'payments.write', 'orders.read', 'catalog.read', 'refunds.read'],
    mapping: ['organization', 'account', 'location'], health: ['auth', 'read', 'write', 'webhook', 'quota', 'reconciliation'], logo: logo('square', '#006AFF'), webhooks: true,
  },
  {
    id: 'stripe', provider: 'Stripe', displayName: 'Stripe', category: 'finance', availability: 'available', authentication: 'oauth2',
    summary: 'Read-only balances, payouts, invoices, subscriptions, and reconciliation.',
    capabilities: ['balances.read', 'payouts.read', 'invoices.read', 'subscriptions.read'], mapping: ['organization', 'account'],
    health: ['auth', 'read', 'webhook', 'quota', 'reconciliation'], logo: logo('stripe', '#635BFF'), webhooks: true,
  },
  {
    id: 'quickbooks-online', provider: 'Intuit', displayName: 'QuickBooks Online', category: 'finance', availability: 'available', authentication: 'oauth2',
    summary: 'Read-only reports, invoices, expenses, vendors, and accounts.',
    capabilities: ['reports.read', 'invoices.read', 'expenses.read', 'vendors.read', 'accounts.read'], mapping: ['organization', 'account'],
    health: ['auth', 'read', 'quota', 'reconciliation'], logo: logo('quickbooks', '#2CA01C'),
  },
  {
    id: 'plaid', provider: 'Plaid', displayName: 'Plaid', category: 'finance', availability: 'available', authentication: 'api-key-reference',
    summary: 'Read-only balances and incremental transaction synchronization.', capabilities: ['balances.read', 'transactions.sync'],
    mapping: ['organization', 'account'], health: ['auth', 'read', 'webhook', 'quota', 'reconciliation'], logo: logo('plaid', '#000000'), webhooks: true,
  },
  {
    id: 'slack', provider: 'Slack', displayName: 'Slack', category: 'communications', availability: 'available', authentication: 'oauth2',
    summary: 'Selected-channel alerts, daily summaries, tests, and revocation.', capabilities: ['channels.read', 'alerts.write', 'summaries.write'],
    mapping: ['organization', 'account', 'location'], health: ['auth', 'read', 'write', 'webhook', 'quota'], logo: logo('slack', '#4A154B', 'retain-official-mark'), webhooks: true,
  },
  {
    id: 'twilio', provider: 'Twilio', displayName: 'Twilio', category: 'communications', availability: 'available', authentication: 'api-key-reference',
    summary: 'Verified SMS senders, delivery status, quotas, and webhook reconciliation.', capabilities: ['sms.send', 'senders.read', 'delivery.read'],
    mapping: ['organization', 'account'], health: ['auth', 'read', 'write', 'webhook', 'quota', 'reconciliation'], logo: logo('twilio', '#F22F46'), webhooks: true,
  },
  {
    id: 'resend', provider: 'Resend', displayName: 'Resend', category: 'communications', availability: 'available', authentication: 'api-key-reference',
    summary: 'Transactional email, sender health, delivery events, and suppressions.', capabilities: ['email.send', 'domains.read', 'delivery.read', 'suppressions.read'],
    mapping: ['organization', 'account'], health: ['auth', 'read', 'write', 'webhook', 'quota'], logo: logo('resend', '#000000'), webhooks: true,
  },
  {
    id: 'sendgrid', provider: 'Twilio SendGrid', displayName: 'SendGrid', category: 'communications', availability: 'available', authentication: 'api-key-reference',
    summary: 'Transactional email, verified senders, delivery events, and suppression health.', capabilities: ['email.send', 'senders.read', 'delivery.read', 'suppressions.read'],
    mapping: ['organization', 'account'], health: ['auth', 'read', 'write', 'webhook', 'quota', 'reconciliation'], logo: logo('sendgrid', '#1A82E2'), webhooks: true,
  },
  {
    id: 'supabase', provider: 'Supabase', displayName: 'Supabase', category: 'platform', availability: 'available', authentication: 'oauth2',
    summary: 'Database, Auth, Storage, Realtime, migration, and security health.', capabilities: ['database.health', 'auth.health', 'storage.health', 'realtime.health', 'migrations.read', 'security-advisors.read'],
    mapping: ['organization', 'account'], health: ['auth', 'read', 'quota'], logo: logo('supabase', '#3FCF8E'),
  },
  {
    id: 'vercel', provider: 'Vercel', displayName: 'Vercel', category: 'platform', availability: 'available', authentication: 'oauth2',
    summary: 'Deployment, domain, cron, workflow, environment, and runtime health.', capabilities: ['deployments.read', 'domains.read', 'cron.read', 'workflows.read', 'environment.read', 'runtime.health'],
    mapping: ['organization', 'account'], health: ['auth', 'read', 'webhook', 'quota'], logo: logo('vercel', '#000000'), webhooks: true,
  },
  {
    id: 'sentry', provider: 'Sentry', displayName: 'Sentry', category: 'platform', availability: 'available', authentication: 'oauth2',
    summary: 'Releases, error trends, affected apps, and unresolved production issues.', capabilities: ['releases.read', 'issues.read', 'trends.read'],
    mapping: ['organization', 'account'], health: ['auth', 'read', 'webhook', 'quota'], logo: logo('sentry', '#362D59'), webhooks: true,
  },
  ...[
    ['shopify', 'Shopify', 'shopify', '#7AB55C'],
    ['cloudflare', 'Cloudflare', 'cloudflare', '#F38020'],
    ['github', 'GitHub', 'github', '#181717'],
    ['expo', 'Expo', 'expo', '#1C2024'],
    ['apple-distribution', 'Apple Distribution', 'apple', '#000000'],
    ['google-play', 'Google Play', 'googleplay', '#414141'],
    ['checkly', 'Checkly', 'checkly', '#AC7EF4'],
    ['turnstile', 'Turnstile', 'cloudflare', '#F38020'],
  ].map(([id, displayName, slug, color]) => ({
    id: id ?? '', provider: displayName ?? '', displayName: displayName ?? '', category: 'platform' as const,
    availability: 'coming-soon' as const, authentication: 'oauth2' as const,
    summary: 'Planned integration. Provider certification is not yet available.', capabilities: [`${id ?? 'provider'}.planned`],
    mapping: ['organization'] as const, health: ['auth'] as const,
    logo: logo(slug ?? '', (color ?? '#000000') as `#${string}`),
  })),
];

export const OPERATIONS_CONNECTOR_CATALOG: readonly ConnectorCatalogEntry[] =
  Object.freeze(DEFINITIONS.map(entry));

export function listConnectorCatalog(): readonly ConnectorCatalogEntry[] {
  return OPERATIONS_CONNECTOR_CATALOG;
}

export function getConnectorCatalogEntry(id: string): ConnectorCatalogEntry | undefined {
  return OPERATIONS_CONNECTOR_CATALOG.find((catalogEntry) => catalogEntry.descriptor.id === id);
}

export function listConnectorsByAvailability(
  availability: ConnectorAvailability,
): readonly ConnectorCatalogEntry[] {
  return OPERATIONS_CONNECTOR_CATALOG.filter((catalogEntry) => catalogEntry.availability === availability);
}
