import { connectorCallbackPath, logo, oauthSetup, type CatalogDefinition } from './catalog-definition';

/**
 * Social audience providers. All three ship a hosted OAuth client, so the owner
 * never copies a secret: the deployment holds the client and Connect is one press.
 */
export const AUDIENCE_DEFINITIONS: readonly CatalogDefinition[] = [
  {
    id: 'meta-business-suite', provider: 'Meta', displayName: 'Meta Business Suite',
    category: 'marketing', availability: 'provider-approval-required', authentication: 'oauth2',
    summary: 'Facebook and Instagram pages, post insights, ad reporting, and lead forms.',
    capabilities: ['pages.read', 'pages.publish', 'instagram.read', 'insights.read', 'ads.reporting', 'leadgen.read'],
    mapping: ['organization', 'account', 'location'],
    health: ['auth', 'read', 'write', 'webhook', 'quota'],
    logo: logo('meta', '#0467DF', 'retain-official-mark'), webhooks: true,
    setup: oauthSetup({
      redirectPath: connectorCallbackPath('meta-business-suite'), estimatedMinutes: 2,
      consoleUrl: 'https://developers.facebook.com/apps',
      documentationUrl: 'https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow',
      operatorSteps: [
        { text: 'Choose the Business portfolio and the specific Pages this organization owns.' },
        { text: 'Meta reviews advanced permissions before live data flows; sandbox works immediately.', href: 'https://developers.facebook.com/docs/app-review' },
      ],
    }),
  },
  {
    id: 'youtube', provider: 'Google', displayName: 'YouTube', category: 'marketing',
    availability: 'available', authentication: 'oauth2',
    summary: 'Channel uploads, video metadata, playlists, and YouTube Analytics reporting.',
    capabilities: ['channel.read', 'videos.read', 'videos.upload', 'playlists.write', 'analytics.reporting'],
    mapping: ['organization', 'account'],
    health: ['auth', 'read', 'write', 'quota'],
    logo: logo('youtube', '#FF0000', 'retain-official-mark'),
    setup: oauthSetup({
      redirectPath: connectorCallbackPath('youtube'),
      consoleUrl: 'https://console.cloud.google.com/apis/credentials',
      documentationUrl: 'https://developers.google.com/youtube/v3/guides/authentication',
      operatorSteps: [
        { text: 'Sign in with the Google account that owns the channel, not a viewer account.' },
        { text: 'Uploads stay private until you publish them from the channel.' },
      ],
    }),
  },
  {
    id: 'tiktok', provider: 'TikTok', displayName: 'TikTok', category: 'marketing',
    availability: 'provider-approval-required', authentication: 'oauth2',
    summary: 'Creator profile, video list, direct post publishing, and post analytics.',
    capabilities: ['profile.read', 'videos.read', 'videos.publish', 'analytics.read'],
    mapping: ['organization', 'account'],
    health: ['auth', 'read', 'write', 'quota'],
    logo: logo('tiktok', '#000000', 'retain-official-mark'),
    setup: oauthSetup({
      redirectPath: connectorCallbackPath('tiktok'), estimatedMinutes: 2,
      consoleUrl: 'https://developers.tiktok.com/apps',
      documentationUrl: 'https://developers.tiktok.com/doc/login-kit-web',
      operatorSteps: [
        { text: 'You are granting read access only: profile, video list and post analytics.' },
        { text: 'Publishing needs the video.publish scope, which is deliberately not requested until TikTok\'s content-posting audit passes.', href: 'https://developers.tiktok.com/doc/content-posting-api-get-started' },
      ],
    }),
  },
] as const;
