export const OAUTH_CONNECTOR_KEYS = [
  'google-suite', 'stripe', 'quickbooks-online', 'slack',
  'meta-business-suite', 'youtube', 'tiktok',
] as const;
export type OAuthConnectorKey = (typeof OAUTH_CONNECTOR_KEYS)[number];

export type ProviderConfig = {
  readonly authorizeUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: readonly string[];
  readonly tokenUrl: string;
  /** Send client credentials as HTTP Basic instead of form fields. */
  readonly useBasic?: boolean;
  readonly usePkce?: boolean;
  /** Separator the provider expects between scopes. Defaults to a space. */
  readonly scopeSeparator?: string;
  /**
   * Parameter name carrying the client identifier. TikTok names it `client_key`
   * on both the authorize and token endpoints.
   */
  readonly clientIdParam?: string;
  /** Meta serves its token exchange over GET with query parameters. */
  readonly tokenMethod?: 'GET' | 'POST';
  /** Extra authorize-only parameters the provider requires. */
  readonly authorizeParams?: Readonly<Record<string, string>>;
};

function value(name: string): string {
  return process.env[name]?.trim() ?? '';
}

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

export function isOAuthConnectorKey(candidate: string): candidate is OAuthConnectorKey {
  return (OAUTH_CONNECTOR_KEYS as readonly string[]).includes(candidate);
}

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_OFFLINE = Object.freeze({
  access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent',
});
const META_VERSION = 'v25.0';

const CONFIGS: Readonly<Record<OAuthConnectorKey, () => ProviderConfig>> = {
  'google-suite': () => ({
    authorizeUrl: GOOGLE_AUTHORIZE, tokenUrl: GOOGLE_TOKEN, usePkce: true,
    clientId: value('GOOGLE_OAUTH_CLIENT_ID'), clientSecret: value('GOOGLE_OAUTH_CLIENT_SECRET'),
    authorizeParams: GOOGLE_OFFLINE,
    scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.compose'],
  }),
  youtube: () => ({
    authorizeUrl: GOOGLE_AUTHORIZE, tokenUrl: GOOGLE_TOKEN, usePkce: true,
    clientId: value('YOUTUBE_OAUTH_CLIENT_ID'), clientSecret: value('YOUTUBE_OAUTH_CLIENT_SECRET'),
    authorizeParams: GOOGLE_OFFLINE,
    scopes: ['openid', 'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/yt-analytics.readonly'],
  }),
  stripe: () => ({
    authorizeUrl: 'https://connect.stripe.com/oauth/authorize',
    tokenUrl: 'https://connect.stripe.com/oauth/token', useBasic: true, scopes: [],
    clientId: value('STRIPE_CONNECT_CLIENT_ID'), clientSecret: value('STRIPE_SECRET_KEY'),
  }),
  'quickbooks-online': () => ({
    authorizeUrl: 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    useBasic: true, scopes: ['com.intuit.quickbooks.accounting'],
    clientId: value('QUICKBOOKS_CLIENT_ID'), clientSecret: value('QUICKBOOKS_CLIENT_SECRET'),
  }),
  slack: () => ({
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access', usePkce: true, scopeSeparator: ',',
    clientId: value('SLACK_CLIENT_ID'), clientSecret: value('SLACK_CLIENT_SECRET'),
    scopes: ['channels:read', 'chat:write'],
  }),
  'meta-business-suite': () => ({
    authorizeUrl: `https://www.facebook.com/${META_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${META_VERSION}/oauth/access_token`,
    tokenMethod: 'GET', scopeSeparator: ',',
    clientId: value('META_APP_ID'), clientSecret: value('META_APP_SECRET'),
    scopes: ['public_profile', 'business_management', 'pages_show_list',
      'pages_read_engagement', 'read_insights', 'ads_read'],
  }),
  tiktok: () => ({
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    usePkce: true, scopeSeparator: ',', clientIdParam: 'client_key',
    clientId: value('TIKTOK_CLIENT_KEY'), clientSecret: value('TIKTOK_CLIENT_SECRET'),
    scopes: ['user.info.basic', 'user.info.profile', 'video.list'],
  }),
};

/** Returns the provider configuration only when both credentials are present. */
export function connectorProviderConfig(key: OAuthConnectorKey): ProviderConfig | null {
  const config = CONFIGS[key]();
  return config.clientId && config.clientSecret ? config : null;
}

export function connectorProviderReady(key: OAuthConnectorKey): boolean {
  return connectorProviderConfig(key) !== null;
}

export function connectorProviderScopes(key: OAuthConnectorKey): readonly string[] {
  return connectorProviderConfig(key)?.scopes ?? [];
}

export function connectorCallbackUrl(key: OAuthConnectorKey, requestOrigin: string): string | null {
  const configured = value('CONNECTOR_PUBLIC_ORIGIN') || value('PLATFORM_BASE_URL');
  const candidate = configured || (process.env.NODE_ENV !== 'production' ? requestOrigin : '');
  try {
    const origin = new URL(candidate);
    const local = origin.hostname === '127.0.0.1' || origin.hostname === 'localhost';
    if (origin.origin !== candidate.replace(/\/$/, '') || (origin.protocol !== 'https:' && !local)) return null;
    return `${origin.origin}/api/connectors/${key}/callback`;
  } catch { return null; }
}

export function connectorAuthorizationUrl(
  key: OAuthConnectorKey,
  state: string,
  codeChallenge: string,
  callbackUrl: string,
): URL | null {
  const config = connectorProviderConfig(key);
  if (!config) return null;
  const url = new URL(config.authorizeUrl);
  url.searchParams.set(config.clientIdParam ?? 'client_id', config.clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (config.scopes.length) {
    url.searchParams.set('scope', config.scopes.join(config.scopeSeparator ?? ' '));
  }
  if (config.usePkce) {
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [name, extra] of Object.entries(config.authorizeParams ?? {})) {
    url.searchParams.set(name, extra);
  }
  return url;
}
