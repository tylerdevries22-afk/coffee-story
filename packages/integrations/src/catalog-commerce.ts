import { apiKeySetup, connectorCallbackPath, logo, oauthSetup, type CatalogDefinition } from './catalog-definition';

/** Commerce and finance providers that move or reconcile money. */
export const COMMERCE_DEFINITIONS: readonly CatalogDefinition[] = [
  {
    id: 'square', provider: 'Square', displayName: 'Square', category: 'commerce',
    availability: 'available', authentication: 'oauth2',
    summary: 'Location payments, orders, catalog, refunds, and reconciliation.',
    capabilities: ['payments.read', 'payments.write', 'orders.read', 'catalog.read', 'refunds.read'],
    mapping: ['organization', 'account', 'location'],
    health: ['auth', 'read', 'write', 'webhook', 'quota', 'reconciliation'],
    logo: logo('square', '#006AFF'), webhooks: true,
    setup: oauthSetup({ estimatedMinutes: 2,
      redirectPath: '/api/square/callback',
      consoleUrl: 'https://developer.squareup.com/apps',
      documentationUrl: 'https://developer.squareup.com/docs/oauth-api/overview',
      operatorSteps: [
        { text: 'Pick the location this Square account should post against.', href: '/locations' },
      ],
    }),
  },
  {
    id: 'stripe', provider: 'Stripe', displayName: 'Stripe', category: 'finance',
    availability: 'available', authentication: 'oauth2',
    summary: 'Read-only balances, payouts, invoices, subscriptions, and reconciliation.',
    capabilities: ['balances.read', 'payouts.read', 'invoices.read', 'subscriptions.read'],
    mapping: ['organization', 'account'],
    health: ['auth', 'read', 'webhook', 'quota', 'reconciliation'],
    logo: logo('stripe', '#635BFF'), webhooks: true,
    setup: oauthSetup({
      redirectPath: connectorCallbackPath('stripe'),
      consoleUrl: 'https://dashboard.stripe.com/settings/connect/onboarding-options/oauth',
      documentationUrl: 'https://docs.stripe.com/connect/oauth-reference',
      operatorSteps: [],
    }),
  },
  {
    id: 'quickbooks-online', provider: 'Intuit', displayName: 'QuickBooks Online',
    category: 'finance', availability: 'available', authentication: 'oauth2',
    summary: 'Read-only reports, invoices, expenses, vendors, and accounts.',
    capabilities: ['reports.read', 'invoices.read', 'expenses.read', 'vendors.read', 'accounts.read'],
    mapping: ['organization', 'account'], health: ['auth', 'read', 'quota', 'reconciliation'],
    logo: logo('quickbooks', '#2CA01C'),
    setup: oauthSetup({
      redirectPath: connectorCallbackPath('quickbooks-online'), estimatedMinutes: 2,
      consoleUrl: 'https://developer.intuit.com/app/developer/myapps',
      documentationUrl: 'https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0',
      operatorSteps: [
        { text: 'Choose the company file to sync when Intuit lists more than one.' },
      ],
    }),
  },
  {
    id: 'plaid', provider: 'Plaid', displayName: 'Plaid', category: 'finance',
    availability: 'available', authentication: 'api-key-reference',
    summary: 'Read-only balances and incremental transaction synchronization.',
    capabilities: ['balances.read', 'transactions.sync'],
    mapping: ['organization', 'account'],
    health: ['auth', 'read', 'webhook', 'quota', 'reconciliation'],
    logo: logo('plaid', '#000000'), webhooks: true,
    setup: apiKeySetup({
      estimatedMinutes: 4,
      consoleUrl: 'https://dashboard.plaid.com/developers/keys',
      documentationUrl: 'https://plaid.com/docs/quickstart/',
      steps: [
        { text: 'Open Plaid Dashboard, then Developers, then Keys.', href: 'https://dashboard.plaid.com/developers/keys' },
        { text: 'Copy the client ID and the secret for the environment you are launching in.' },
        { text: 'Note which Plaid environment the keys belong to; they are not interchangeable.' },
      ],
    }),
  },
] as const;
