import { logo, portalSetup, type CatalogDefinition } from './catalog-definition';

const PLANNED: readonly (readonly [string, string, string, `#${string}`])[] = [
  ['shopify', 'Shopify', 'shopify', '#7AB55C'],
  ['cloudflare', 'Cloudflare', 'cloudflare', '#F38020'],
  ['github', 'GitHub', 'github', '#181717'],
  ['expo', 'Expo', 'expo', '#1C2024'],
  ['apple-distribution', 'Apple Distribution', 'apple', '#000000'],
  ['google-play', 'Google Play', 'googleplay', '#414141'],
  ['checkly', 'Checkly', 'checkly', '#AC7EF4'],
  ['turnstile', 'Turnstile', 'cloudflare', '#F38020'],
];

/** Roadmap entries. Listed for visibility; every setup action stays disabled. */
export const PLANNED_DEFINITIONS: readonly CatalogDefinition[] = PLANNED.map(
  ([id, displayName, slug, color]) => ({
    id, provider: displayName, displayName, category: 'platform' as const,
    availability: 'coming-soon' as const, authentication: 'oauth2' as const,
    summary: 'Planned integration. Provider certification is not yet available.',
    capabilities: [`${id}.planned`],
    mapping: ['organization'] as const, health: ['auth'] as const,
    logo: logo(slug, color),
    setup: portalSetup({
      estimatedMinutes: 0,
      consoleUrl: 'https://simpleicons.org/',
      documentationUrl: 'https://simpleicons.org/',
      steps: [{ text: 'Awaiting sandbox certification. Nothing to configure yet.' }],
    }),
  }),
);
