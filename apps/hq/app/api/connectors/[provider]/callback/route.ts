import { mcpCookieBindingMatches, mcpSha256 } from 'franchise-mcp-store-ui/oauth';
import { NextResponse } from 'next/server';

import { AppNetworkError } from '@platform/api-client';
import { ExternalRequestError } from '@platform/engine';

import {
  ConnectorExchangeError,
  ConnectorIdentityError,
  connectorCallbackUrl,
  exchangeConnectorCode,
  hasCompleteConnectorGrant,
  isOAuthConnectorKey,
  resolveGrantedScopes,
  revokeConnectorToken,
  verifyConnectorIdentity,
  type ConnectorToken,
  type OAuthConnectorKey,
} from '@/lib/connector-oauth-providers';
import {
  authorizeConnectorOAuth,
  connectorCookieName,
  parseConnectorCookie,
  verifyConnectorState,
} from '@/lib/connector-oauth-route';
import {
  completeConnectorOAuth,
  ConnectorCompletionError,
} from '@/lib/connector-oauth-completion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ConsumedState = {
  readonly brand_id: string;
  readonly installation_id: string;
  readonly cookie_binding_hash: string;
  readonly redirect_uri: string;
};

function finish(request: Request, provider: OAuthConnectorKey, outcome: string): Response {
  const target = new URL(`/integrations?connection=${encodeURIComponent(outcome)}`, request.url);
  const response = NextResponse.redirect(target, 302);
  response.headers.append('Set-Cookie', `${connectorCookieName(provider)}=; Path=/api/connectors/${provider}/callback; Max-Age=0; HttpOnly; SameSite=Lax`);
  return response;
}

/**
 * Records which stage failed, without the code, the token, or any credential.
 *
 * Every cause previously collapsed into one opaque redirect, so an operator could
 * not tell a stale client secret from a declined scope or a storage error.
 */
function reportFailure(provider: OAuthConnectorKey, error: unknown): 'connection_failed' {
  const stage = error instanceof ConnectorExchangeError ? error.stage
    : error instanceof ConnectorScopeError ? 'scope'
    : error instanceof ConnectorIdentityError ? 'identity'
    : error instanceof ConnectorCompletionError
      ? error.cleanupSucceeded ? 'storage' : 'cleanup'
    // Bounded provider transport raises this for identity timeouts and failures.
    // call, which is a provider problem rather than a storage one. The permissions
    // call catches its own failures and surfaces as `scope`, above.
    : error instanceof AppNetworkError || error instanceof ExternalRequestError
      ? 'transport' : 'storage';
  const status = error instanceof ConnectorExchangeError && error.status !== null
    ? ` status=${error.status}` : '';
  console.error(`connector.oauth.callback provider=${provider} stage=${stage}${status}`);
  return 'connection_failed';
}

/**
 * Raised when the granted scopes cannot be established.
 *
 * Storing the installation anyway would mark it connected and healthy with an
 * empty capability set. A narrowed grant is recoverable — the card reports the
 * gap and offers a reconnect — but an unknown one is not, because there is
 * nothing to compare against. Failing here leaves the owner able to press Connect
 * again rather than acting on a number we could not establish.
 */
class ConnectorScopeError extends Error {
  constructor() {
    super('Connector granted scopes could not be verified.');
    this.name = 'ConnectorScopeError';
  }
}

function expiryOf(token: Readonly<Record<string, unknown>>): string | null {
  const seconds = Reflect.get(token, 'expires_in');
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? new Date(Date.now() + seconds * 1_000).toISOString() : null;
}

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly provider: string }> },
): Promise<Response> {
  const provider = (await params).provider;
  if (!isOAuthConnectorKey(provider)) return new Response('Unknown connector.', { status: 404 });
  const url = new URL(request.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  const signed = verifyConnectorState(state, provider);
  const cookie = parseConnectorCookie(request, provider);
  if (!signed || !cookie || !code || code.length > 8_192) return finish(request, provider, 'invalid_state');
  const context = await authorizeConnectorOAuth(request, false);
  if (context instanceof Response) return context;
  const consumed = await context.db.rpc('consume_connector_oauth_state', {
    p_provider_key: provider,
    p_actor_user_id: context.userId,
    p_state_hash: mcpSha256(signed.nonce),
  });
  const record = Array.isArray(consumed.data) ? consumed.data[0] as ConsumedState | undefined : undefined;
  if (consumed.error || !record
    || !mcpCookieBindingMatches(cookie.binding, record.cookie_binding_hash)) {
    return finish(request, provider, 'invalid_state');
  }
  const callbackUrl = connectorCallbackUrl(provider, url.origin);
  if (!callbackUrl || callbackUrl !== record.redirect_uri) return finish(request, provider, 'invalid_state');
  let exchangedToken: ConnectorToken | null = null;
  try {
    const token = await exchangeConnectorCode(provider, code, cookie.verifier, callbackUrl);
    exchangedToken = token;
    const grantedScopes = await resolveGrantedScopes(provider, token);
    if (grantedScopes === null || !hasCompleteConnectorGrant(provider, grantedScopes)) {
      throw new ConnectorScopeError();
    }
    const identity = await verifyConnectorIdentity(provider, token, url.searchParams.get('realmId'));
    const credential = { ...token, external_account_id: identity.accountId, acquired_at: new Date().toISOString() };
    await completeConnectorOAuth(context.db, {
      brandId: record.brand_id,
      installationId: record.installation_id,
      provider,
      actorUserId: context.userId,
      credential,
      accountId: identity.accountId,
      accountLabel: identity.accountLabel,
      grantedScopes,
      expiresAt: expiryOf(token),
    });
    return finish(request, provider, 'connected');
  } catch (error) {
    let reported = error;
    if (exchangedToken && !(error instanceof ConnectorCompletionError)) {
      const cleaned = await revokeConnectorToken(provider, exchangedToken);
      if (!cleaned) reported = new ConnectorCompletionError(false);
    }
    return finish(request, provider, reportFailure(provider, reported));
  }
}
