import { createMcpOAuthMaterial } from 'franchise-mcp-store-ui/oauth';
import { NextResponse } from 'next/server';

import {
  connectorAuthorizationUrl,
  connectorCallbackUrl,
  connectorProviderReady,
  connectorProviderScopes,
  isOAuthConnectorKey,
} from '@/lib/connector-oauth-providers';
import {
  authorizeConnectorOAuth,
  connectorCookieName,
  connectorStateSecret,
} from '@/lib/connector-oauth-route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly provider: string }> },
): Promise<Response> {
  const provider = (await params).provider;
  if (!isOAuthConnectorKey(provider)) return new Response('Unknown connector.', { status: 404 });
  const context = await authorizeConnectorOAuth(request);
  if (context instanceof Response) return context;
  const callbackUrl = connectorCallbackUrl(provider, new URL(request.url).origin);
  const providerReady = connectorProviderReady(provider);
  let material;
  try {
    if (!callbackUrl || !providerReady) throw new Error('not configured');
    material = createMcpOAuthMaterial(provider, connectorStateSecret());
  } catch {
    return new Response('This connector is not configured for this deployment.', { status: 503 });
  }
  const authorizeUrl = connectorAuthorizationUrl(
    provider, material.state, material.codeChallenge, callbackUrl,
  );
  if (!authorizeUrl) return new Response('This connector is not configured.', { status: 503 });
  const begun = await context.db.rpc('begin_connector_oauth_state', {
    p_brand_id: context.brandId,
    p_provider_key: provider,
    p_actor_user_id: context.userId,
    p_state_hash: material.nonceSha256,
    p_cookie_binding_hash: material.cookieBindingSha256,
    p_requested_scopes: connectorProviderScopes(provider),
    p_redirect_uri: callbackUrl,
    p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (begun.error) return new Response('Connector setup could not be started.', { status: 503 });
  const response = NextResponse.redirect(authorizeUrl, 302);
  const cookie = Buffer.from(JSON.stringify({
    binding: material.cookieBinding,
    verifier: material.codeVerifier,
  })).toString('base64url');
  response.headers.append('Set-Cookie', `${connectorCookieName(provider)}=${cookie}; Path=/api/connectors/${provider}/callback; Max-Age=600; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return response;
}
