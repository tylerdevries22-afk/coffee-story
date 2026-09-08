import { call, HOSTS, type SquareConfig } from './transport';

/** The consent URL Locations' "Connect Square" sends a browser to. */
export function oauthAuthorizeUrl(config: SquareConfig, state: string): string {
  const scopes = ['MERCHANT_PROFILE_READ', 'ORDERS_WRITE', 'ORDERS_READ', 'PAYMENTS_WRITE', 'PAYMENTS_READ'];
  const params = new URLSearchParams({
    client_id: config.applicationId,
    scope: scopes.join(' '),
    session: 'false',
    state,
  });
  return `${HOSTS[config.env]}/oauth2/authorize?${params}`;
}
export type OAuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  merchant_id: string;
};

export function exchangeOAuthCode(config: SquareConfig, code: string): Promise<OAuthTokens> {
  return call<OAuthTokens>(config, '/oauth2/token', {
    method: 'POST',
    body: {
      client_id: config.applicationId,
      client_secret: config.applicationSecret,
      grant_type: 'authorization_code',
      code,
    },
  });
}

export function refreshOAuthToken(config: SquareConfig, refreshToken: string): Promise<OAuthTokens> {
  return call<OAuthTokens>(config, '/oauth2/token', {
    method: 'POST',
    body: {
      client_id: config.applicationId,
      client_secret: config.applicationSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    },
  });
}

export function revokeOAuthToken(
  config: SquareConfig,
  accessToken: string,
  options: { revokeOnlyAccessToken?: boolean } = {},
): Promise<unknown> {
  return call(config, '/oauth2/revoke', {
    method: 'POST',
    clientAuthorization: true,
    body: {
      client_id: config.applicationId,
      access_token: accessToken,
      // Token retirement during a refresh must preserve the refresh grant;
      // an explicit disconnect leaves the default false so the grant cannot
      // remain usable after the local connection is deleted.
      ...(options.revokeOnlyAccessToken ? { revoke_only_access_token: true } : {}),
    },
  });
}

/**
 * A stored access token, judged against its recorded expiry.
 *
 * `refreshOAuthToken` existed and nothing called it: `square_connections`
 * stored `expires_at` and no code read it. A Square access token lasts thirty
 * days, so every connected shop would have stopped taking cards a month after
 * connecting, on a 401 from Square that nothing in the product explained.
 *
 * Three states rather than a boolean, because what to do when the refresh
 * itself fails depends on which one it is: a token inside the margin is still
 * good and the sale should go through on it, while an expired one must not be
 * sent to Square as if it were money.
 *
 * An absent or unreadable expiry reads as `refresh_soon`: a connection stored
 * before this was checked should be renewed if it can be, and still spend if
 * it cannot.
 */
export type SquareTokenState = 'fresh' | 'refresh_soon' | 'expired';

/**
 * Square's 30-day token lifetime minus its required seven-day renewal age.
 *
 * The comparison below is against time *remaining*, so a seven-day refresh
 * cadence is a 23-day expiry margin. Using seven here waits until day 23 to
 * renew, which is the inverse of Square's requirement and leaves only one
 * week to discover a broken refresh path.
 */
export const SQUARE_REFRESH_MARGIN_MS = 23 * 24 * 60 * 60 * 1000;

export function squareTokenState(
  expiresAt: string | null | undefined,
  nowMs: number,
  marginMs: number = SQUARE_REFRESH_MARGIN_MS,
): SquareTokenState {
  if (!expiresAt) return 'refresh_soon';
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return 'refresh_soon';
  if (nowMs >= expiry) return 'expired';
  return nowMs >= expiry - marginMs ? 'refresh_soon' : 'fresh';
}
