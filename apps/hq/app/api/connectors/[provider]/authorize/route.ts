import { NextResponse } from 'next/server';

import { connectorOAuthAuthorizeDependencies as dependencies } from '@/lib/connector-oauth-authorize-dependencies';
import { isOAuthConnectorKey } from '@/lib/connector-oauth-providers';
import { authorizeConnectorOAuth } from '@/lib/connector-oauth-route';
import {
  disconnectConnectorOAuth,
  sameOriginConnectorMutation,
} from '@/lib/connector-oauth-disconnect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function beginOutcome(value: unknown): 'authorization_ready' | 'revocation_pending' | null {
  if (!value || typeof value !== 'object') return null;
  const status = Reflect.get(value, 'status');
  const installationId = Reflect.get(value, 'installationId');
  return (status === 'authorization_ready' || status === 'revocation_pending')
    && typeof installationId === 'string' && UUID.test(installationId) ? status : null;
}

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly provider: string }> },
): Promise<Response> {
  const provider = (await params).provider;
  if (!dependencies.isProvider(provider)) return new Response('Unknown connector.', { status: 404 });
  const context = await dependencies.authorize(request);
  if (context instanceof Response) return context;
  const callbackUrl = dependencies.callbackUrl(provider, new URL(request.url).origin);
  const providerReady = dependencies.providerReady(provider);
  let material;
  try {
    if (!callbackUrl || !providerReady) throw new Error('not configured');
    material = dependencies.createMaterial(provider, dependencies.stateSecret());
  } catch {
    return new Response('This connector is not configured for this deployment.', { status: 503 });
  }
  const authorizeUrl = dependencies.authorizationUrl(
    provider, material.state, material.codeChallenge, callbackUrl,
  );
  if (!authorizeUrl) return new Response('This connector is not configured.', { status: 503 });
  let begun;
  try {
    begun = await dependencies.beginState(context.db, {
      p_brand_id: context.brandId,
      p_provider_key: provider,
      p_actor_user_id: context.userId,
      p_state_hash: material.nonceSha256,
      p_cookie_binding_hash: material.cookieBindingSha256,
      p_requested_scopes: dependencies.scopes(provider),
      p_redirect_uri: callbackUrl,
      p_expires_at: new Date(dependencies.now().getTime() + 10 * 60_000).toISOString(),
    });
  } catch {
    return new Response('Connector setup could not be started.', { status: 503 });
  }
  const outcome = begun.error ? null : beginOutcome(begun.data);
  if (outcome === 'revocation_pending') {
    return new Response('The previous connector authorization is still being revoked.', { status: 409 });
  }
  if (outcome !== 'authorization_ready') {
    return new Response('Connector setup could not be started.', { status: 503 });
  }
  const response = NextResponse.redirect(authorizeUrl, 302);
  const cookie = Buffer.from(JSON.stringify({
    binding: material.cookieBinding,
    operationKey: dependencies.randomUuid(),
    verifier: material.codeVerifier,
  })).toString('base64url');
  response.headers.append('Set-Cookie', `${dependencies.cookieName(provider, material.nonce)}=${cookie}; Path=/api/connectors/${provider}/callback; Max-Age=600; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  return response;
}

export async function DELETE(
  request: Request,
  { params }: { readonly params: Promise<{ readonly provider: string }> },
): Promise<Response> {
  const provider = (await params).provider;
  if (!isOAuthConnectorKey(provider)) return new Response('Unknown connector.', { status: 404 });
  return sameOriginConnectorMutation(request, async () => {
    const context = await authorizeConnectorOAuth(request);
    if (context instanceof Response) return context;
    try {
      await disconnectConnectorOAuth(context.db, {
        brandId: context.brandId,
        providerKey: provider,
        actorUserId: context.userId,
      });
      return Response.json({ ok: true });
    } catch {
      console.error(`connector.oauth.disconnect provider=${provider} stage=disconnect code=disconnect_failed status=503`);
      return Response.json({ code: 'disconnect_failed', message: 'Connector disconnect failed.' }, { status: 503 });
    }
  });
}
