import { mcpCookieBindingMatches, mcpSha256 } from 'franchise-mcp-store-ui/oauth';
import { NextResponse } from 'next/server';

import {
  connectorCallbackUrl,
  exchangeConnectorCode,
  grantedConnectorScopes,
  isOAuthConnectorKey,
  verifyConnectorIdentity,
  type OAuthConnectorKey,
} from '@/lib/connector-oauth-providers';
import {
  authorizeConnectorOAuth,
  connectorCookieName,
  parseConnectorCookie,
  verifyConnectorState,
} from '@/lib/connector-oauth-route';

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
  try {
    const token = await exchangeConnectorCode(provider, code, cookie.verifier, callbackUrl);
    const identity = await verifyConnectorIdentity(provider, token, url.searchParams.get('realmId'));
    const credential = { ...token, external_account_id: identity.accountId, acquired_at: new Date().toISOString() };
    const completed = await context.db.rpc('complete_connector_oauth_connection', {
      p_brand_id: record.brand_id,
      p_installation_id: record.installation_id,
      p_provider_key: provider,
      p_actor_user_id: context.userId,
      p_credential: credential,
      p_account_label: identity.accountLabel,
      p_granted_scopes: grantedConnectorScopes(provider, token),
      p_expires_at: expiryOf(token),
    });
    if (completed.error) throw new Error('Connector storage failed.');
    return finish(request, provider, 'connected');
  } catch {
    return finish(request, provider, 'connection_failed');
  }
}
