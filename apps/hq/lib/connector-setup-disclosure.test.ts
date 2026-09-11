import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { listConnectorCatalog } from '@platform/integrations';

import { OAUTH_CONNECTOR_KEYS, connectorProviderScopes } from './connector-oauth-config';

const ENV = [
  'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_PROJECT_NUMBER',
  'YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET',
  'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET',
  'META_APP_ID', 'META_APP_SECRET',
  'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET',
  'QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET',
  'STRIPE_CONNECT_CLIENT_ID', 'STRIPE_SECRET_KEY',
] as const;
const ORIGINAL = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));

/** A provider only reports its scope list once both credentials are present. */
function configureEveryProvider(): void {
  for (const name of ENV) process.env[name] = `configured-${name.toLowerCase()}`;
  process.env.GOOGLE_OAUTH_PROJECT_NUMBER = '123456789';
  process.env.GOOGLE_OAUTH_CLIENT_ID = '123456789-google.apps.googleusercontent.com';
  process.env.YOUTUBE_OAUTH_CLIENT_ID = '123456789-youtube.apps.googleusercontent.com';
}

/**
 * The scope each advertised capability needs, mirroring
 * `connector_capabilities.oauth_scopes` in the migrations.
 *
 * Kept here rather than parsed out of the SQL so it stays readable and a reviewer
 * can check it against the seed in one glance. `null` means the capability needs
 * no scope, which is different from being absent: every advertised capability must
 * appear, or the assertion below is silently vacuous for it. The duplication is
 * deliberate — this is the assertion's own statement of what the walkthroughs must
 * disclose, so it has to be independent of the code it checks.
 */
const CAPABILITY_SCOPES: Readonly<Record<string, string | null>> = {
  // Meta withholds publishing, Instagram and lead retrieval until App Review.
  'meta-business-suite:pages.read': 'pages_show_list',
  'meta-business-suite:pages.publish': 'pages_manage_posts',
  'meta-business-suite:instagram.read': 'instagram_basic',
  'meta-business-suite:insights.read': 'read_insights',
  'meta-business-suite:ads.reporting': 'ads_read',
  'meta-business-suite:leadgen.read': 'leads_retrieval',
  // TikTok withholds publishing until its content-posting audit passes.
  'tiktok:profile.read': 'user.info.basic',
  'tiktok:videos.read': 'video.list',
  'tiktok:videos.publish': 'video.publish',
  'tiktok:analytics.read': 'video.list',
  // YouTube withholds the full read-write scope playlists need.
  'youtube:channel.read': 'https://www.googleapis.com/auth/youtube.readonly',
  'youtube:videos.read': 'https://www.googleapis.com/auth/youtube.readonly',
  'youtube:videos.upload': 'https://www.googleapis.com/auth/youtube.upload',
  'youtube:playlists.write': 'https://www.googleapis.com/auth/youtube',
  'youtube:analytics.reporting': 'https://www.googleapis.com/auth/yt-analytics.readonly',
  // Google withholds Business Profile, Analytics and Ads.
  'google-suite:business-profile.performance': 'https://www.googleapis.com/auth/business.manage',
  'google-suite:business-profile.reviews': 'https://www.googleapis.com/auth/business.manage',
  'google-suite:business-profile.locations': 'https://www.googleapis.com/auth/business.manage',
  'google-suite:gmail.send-reviewed': 'https://www.googleapis.com/auth/gmail.compose',
  'google-suite:drive.import': 'https://www.googleapis.com/auth/drive.file',
  'google-suite:drive.export': 'https://www.googleapis.com/auth/drive.file',
  'google-suite:calendar.read': 'https://www.googleapis.com/auth/calendar.events',
  'google-suite:calendar.write': 'https://www.googleapis.com/auth/calendar.events',
  'google-suite:ga4.reporting': 'https://www.googleapis.com/auth/analytics.readonly',
  'google-suite:google-ads.reporting': 'https://www.googleapis.com/auth/adwords',
  // QuickBooks and Slack request everything they list.
  'quickbooks-online:reports.read': 'com.intuit.quickbooks.accounting',
  'quickbooks-online:invoices.read': 'com.intuit.quickbooks.accounting',
  'quickbooks-online:expenses.read': 'com.intuit.quickbooks.accounting',
  'quickbooks-online:vendors.read': 'com.intuit.quickbooks.accounting',
  'quickbooks-online:accounts.read': 'com.intuit.quickbooks.accounting',
  'slack:channels.read': 'channels:read',
  'slack:alerts.write': 'chat:write',
  'slack:summaries.write': 'chat:write',
  // Stripe Connect issues no scopes at all; access follows the connected account.
  'stripe:balances.read': null,
  'stripe:payouts.read': null,
  'stripe:invoices.read': null,
  'stripe:subscriptions.read': null,
};

afterEach(() => {
  for (const name of ENV) {
    const original = ORIGINAL[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe('connector setup disclosure', { concurrency: false }, () => {
  it('discloses every capability it advertises but cannot currently authorize', () => {
    // A walkthrough that stays silent about a withheld scope sends an owner hunting
    // a consent toggle the provider's dialog cannot show. This binds disclosure to
    // the authorize request rather than to any particular wording: if a listed
    // capability needs a scope the request omits, the steps must say so.
    configureEveryProvider();

    for (const key of OAUTH_CONNECTOR_KEYS) {
      const requested = new Set(connectorProviderScopes(key));
      const entry = listConnectorCatalog().find((candidate) => candidate.descriptor.id === key);
      assert.ok(entry, `${key} should be in the catalog`);
      const withheld = entry.descriptor.capabilities
        .map((capability) => CAPABILITY_SCOPES[`${key}:${capability.id}`])
        .filter((scope): scope is string => typeof scope === 'string' && !requested.has(scope));
      const body = entry.setup.steps.map((step) => step.text).join(' ');

      // Every advertised capability must be in the map, or the assertion below is
      // silently vacuous for it.
      for (const capability of entry.descriptor.capabilities) {
        assert.ok(
          `${key}:${capability.id}` in CAPABILITY_SCOPES,
          `${key}:${capability.id} has no CAPABILITY_SCOPES entry, so this test cannot judge it`,
        );
      }

      // No step may tell an owner to switch on a permission. The request is fixed
      // at build time, so anything the dialog shows is already implied by it, and
      // an instruction to enable something reads as a toggle the owner must find.
      assert.ok(
        !/\b(?:approve|turn on|tick|enable|switch on|check)\b[^.]{0,60}\b(?:permission|scope|posting|access)\b/iu
          .test(body),
        `${key} tells an owner to enable a permission they cannot choose`,
      );

      if (withheld.length === 0) {
        assert.ok(
          !/not requested/u.test(body),
          `${key} requests every scope it lists, so it must not claim otherwise`,
        );
        continue;
      }
      // "not requested" is a deliberate contract phrase, not incidental wording:
      // it is what the store row says in place of an in-product explanation.
      assert.match(
        body, /deliberately not requested|not requested until/u,
        `${key} lists ${withheld.length} capabilities needing ${withheld.join(', ')}, `
        + 'which the request omits, and must disclose that',
      );
    }
  });
});
