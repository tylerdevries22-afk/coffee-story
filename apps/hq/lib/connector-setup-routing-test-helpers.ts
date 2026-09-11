import { listConnectorCatalog } from '@platform/integrations';

import {
  certifiedOAuthProviders,
  withConnectorAuthorization,
} from './connector-auth-readiness';
import { connectorCardsOf } from './integration-cards';

const ENV = [
  'CONNECTOR_OAUTH_STATE_SECRET', 'CONNECTOR_PUBLIC_ORIGIN',
  'SQUARE_APP_ID', 'SQUARE_APP_SECRET', 'SQUARE_TOKEN_KEY',
  'YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
  'META_APP_ID', 'META_APP_SECRET',
  'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_TOKEN_ROTATION_ENABLED',
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_PROJECT_NUMBER',
  'QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET',
  'STRIPE_CONNECT_CLIENT_ID', 'STRIPE_SECRET_KEY',
] as const;
const ORIGINAL = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

export const OAUTH_IDS = ['youtube', 'tiktok', 'meta-business-suite'] as const;

export function configureEverything(): void {
  process.env.CONNECTOR_OAUTH_STATE_SECRET = 's'.repeat(48);
  process.env.CONNECTOR_PUBLIC_ORIGIN = 'https://hq.example.com';
  process.env.YOUTUBE_OAUTH_CLIENT_ID = '123456789-youtube.apps.googleusercontent.com';
  process.env.YOUTUBE_OAUTH_CLIENT_SECRET = 'youtube-secret';
  process.env.TIKTOK_CLIENT_KEY = 'tiktok-key';
  process.env.TIKTOK_CLIENT_SECRET = 'tiktok-secret';
  process.env.META_APP_ID = 'meta-app';
  process.env.META_APP_SECRET = 'meta-secret';
  process.env.SLACK_CLIENT_ID = 'slack-client';
  process.env.SLACK_CLIENT_SECRET = 'slack-secret';
  process.env.SLACK_TOKEN_ROTATION_ENABLED = 'true';
  process.env.GOOGLE_OAUTH_CLIENT_ID = '123456789-google.apps.googleusercontent.com';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'google-secret';
  process.env.GOOGLE_OAUTH_PROJECT_NUMBER = '123456789';
  process.env.QUICKBOOKS_CLIENT_ID = 'qb-client';
  process.env.QUICKBOOKS_CLIENT_SECRET = 'qb-secret';
  process.env.STRIPE_CONNECT_CLIENT_ID = 'stripe-client';
  process.env.STRIPE_SECRET_KEY = 'stripe-secret';
}

export function activeRegistry(overrides: Readonly<Record<string, Partial<{
  availability: string; is_active: boolean;
}>>> = {}) {
  return listConnectorCatalog()
    .filter((entry) => entry.availability !== 'coming-soon')
    .map((entry) => ({
      id: entry.descriptor.id,
      provider_key: entry.descriptor.id,
      availability: entry.availability.replaceAll('-', '_'),
      is_active: true,
      ...overrides[entry.descriptor.id],
    }));
}

export function cardsById(
  certified: readonly string[] = [],
  overrides: Parameters<typeof activeRegistry>[0] = {},
) {
  const cards = withConnectorAuthorization(
    connectorCardsOf(activeRegistry(overrides), []), new Set(certified),
  );
  return new Map(cards.map((card) => [card.id, card]));
}

export function restoreConnectorTestEnvironment(): void {
  for (const name of ENV) {
    const original = ORIGINAL[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

export { certifiedOAuthProviders };
