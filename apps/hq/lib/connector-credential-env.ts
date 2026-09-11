import { isOAuthConnectorKey, type OAuthConnectorKey } from './connector-oauth-config';

/**
 * The deployment environment variables each wired provider reads.
 *
 * This lives host-side, not in the shared catalog: the catalog is bundled to the
 * browser through the store's client component, and a list of this deployment's
 * secret names is operator reconnaissance rather than tenant data.
 */
const CREDENTIAL_ENV_KEYS: Readonly<Record<OAuthConnectorKey, readonly string[]>> = {
  'google-suite': ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
  youtube: ['YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET'],
  stripe: ['STRIPE_CONNECT_CLIENT_ID', 'STRIPE_SECRET_KEY'],
  'quickbooks-online': ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET', 'QUICKBOOKS_ENV'],
  slack: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  'meta-business-suite': ['META_APP_ID', 'META_APP_SECRET'],
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
};

/** Env names an operator sets for this provider, or none if it is not wired. */
export function connectorCredentialEnvKeys(key: string): readonly string[] {
  if (isOAuthConnectorKey(key)) return CREDENTIAL_ENV_KEYS[key];
  return key === 'square' ? ['SQUARE_APP_ID', 'SQUARE_APP_SECRET', 'SQUARE_TOKEN_KEY'] : [];
}

/**
 * Env names to show a particular reader, which is none unless they own the
 * organization.
 *
 * A deployment's secret names are operator reconnaissance, so the entitlement
 * check lives here rather than inline in a server component, where it was
 * invisible to the test suite and could be inverted with a green build.
 */
export function visibleCredentialEnvKeys(
  key: string,
  viewer: Readonly<{ isOrganizationOwner: boolean }> | null,
): readonly string[] {
  return viewer?.isOrganizationOwner === true ? connectorCredentialEnvKeys(key) : [];
}
