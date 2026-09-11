import { NextResponse } from 'next/server';

import { AppNetworkError } from '@platform/api-client';

import {
  boundedConnectorScopes, callbackCredential, compensationCredential,
  ConnectorAvailabilityError, ConnectorCompensationIntakeError,
  connectorCompensationReason, compensationTokenExpiryAt,
  ConnectorScopeError, connectorTokenExpiryAt,
  parseConsumedConnectorState,
} from '@/lib/connector-oauth-callback-contract';
import { connectorOAuthCallbackDependencies as dependencies } from '@/lib/connector-oauth-callback-dependencies';
import { ConnectorCompletionError } from '@/lib/connector-oauth-completion';
import { callbackConnectorIdentityHint } from '@/lib/connector-oauth-identity-hint';
import {
  ConnectorExchangeError, ConnectorIdentityError,
  type ConnectorToken, type OAuthConnectorKey,
} from '@/lib/connector-oauth-providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function finish(
  request: Request, provider: OAuthConnectorKey, outcome: string, nonce?: string,
): Response {
  const target = new URL(`/integrations?connection=${encodeURIComponent(outcome)}`, request.url);
  const response = NextResponse.redirect(target, 302);
  if (nonce) {
    const name = dependencies.cookieName(provider, nonce);
    response.headers.append('Set-Cookie', `${name}=; Path=/api/connectors/${provider}/callback; Max-Age=0; HttpOnly; SameSite=Lax`);
  }
  return response;
}

function reportFailure(provider: OAuthConnectorKey, error: unknown): 'connection_failed' {
  const stage = error instanceof ConnectorExchangeError ? error.stage
    : error instanceof ConnectorScopeError ? 'scope'
    : error instanceof ConnectorAvailabilityError ? 'availability'
    : error instanceof ConnectorIdentityError ? 'identity'
    : error instanceof ConnectorCompensationIntakeError
      || (error instanceof ConnectorCompletionError && error.cleanup === 'ambiguous')
      ? 'cleanup'
    : error instanceof AppNetworkError
      || (error instanceof Error && error.name === 'ExternalRequestError')
      ? 'transport' : 'storage';
  const status = error instanceof ConnectorExchangeError && error.status !== null
    ? ` status=${error.status}` : '';
  console.error(`connector.oauth.callback provider=${provider} stage=${stage}${status}`);
  return 'connection_failed';
}

async function ownIssuedCredential(
  context: { readonly db: Parameters<typeof dependencies.compensate>[0]; readonly userId: string },
  state: { readonly brand_id: string; readonly installation_id: string },
  provider: OAuthConnectorKey,
  operationKey: string,
  token: ConnectorToken,
  identity: { readonly accountId: string; readonly accountLabel: string } | null,
  scopes: readonly string[],
  expiresAt: string | null,
  now: Date,
  reason: string,
  identityHint: Readonly<{ realmId?: string }>,
): Promise<'connected' | 'cleanup_queued'> {
  const credential = compensationCredential(token, identity?.accountId ?? null, now);
  if (!credential) throw new ConnectorCompensationIntakeError();
  try {
    const result = await dependencies.compensate(context.db, {
      brandId: state.brand_id, installationId: state.installation_id, provider,
      actorUserId: context.userId, operationKey, credential,
      accountLabel: identity?.accountLabel ?? 'Unverified OAuth account',
      grantedScopes: scopes, expiresAt, reason,
      identityHint,
    });
    return result.outcome;
  } catch {
    throw new ConnectorCompensationIntakeError();
  }
}

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly provider: string }> },
): Promise<Response> {
  const candidate = (await params).provider;
  if (!dependencies.isProvider(candidate)) return new Response('Unknown connector.', { status: 404 });
  const provider = candidate as OAuthConnectorKey;
  const url = new URL(request.url);
  const signed = dependencies.verifyState(url.searchParams.get('state') ?? '', provider);
  if (!signed) return finish(request, provider, 'invalid_state');
  const cookie = dependencies.parseCookie(request, provider, signed.nonce);
  const code = url.searchParams.get('code') ?? '';
  if (!cookie || !code || code.length > 8_192) return finish(request, provider, 'invalid_state', signed.nonce);
  const identityHint = callbackConnectorIdentityHint(provider, url.searchParams.get('realmId'));
  if (!identityHint) return finish(request, provider, 'invalid_state', signed.nonce);
  const context = await dependencies.authorize(request, false);
  if (context instanceof Response) return context;
  const bindingHash = dependencies.sha256(cookie.binding);
  let consumed;
  try {
    consumed = await dependencies.consumeState(context.db, {
      p_provider_key: provider, p_actor_user_id: context.userId,
      p_state_hash: dependencies.sha256(signed.nonce), p_cookie_binding_hash: bindingHash,
      p_consume_key: cookie.operationKey,
    });
  } catch (error) {
    return finish(request, provider, reportFailure(provider, error), signed.nonce);
  }
  if (consumed.error || !Array.isArray(consumed.data)) {
    return finish(request, provider, reportFailure(provider, consumed.error), signed.nonce);
  }
  if (consumed.data.length === 0) return finish(request, provider, 'invalid_state', signed.nonce);
  const state = parseConsumedConnectorState(consumed.data[0], bindingHash, cookie.operationKey);
  if (!state || consumed.data.length !== 1) {
    return finish(request, provider, reportFailure(provider, null), signed.nonce);
  }
  const callbackUrl = dependencies.callbackUrl(provider, url.origin);
  if (!callbackUrl || callbackUrl !== state.redirect_uri) {
    return finish(request, provider, 'invalid_state', signed.nonce);
  }
  if (state.consume_replayed) {
    if (state.completion_outcome === 'connected') {
      return finish(request, provider, 'connected', signed.nonce);
    }
    if (state.completion_outcome === 'cleanup_queued') {
      return finish(request, provider, 'connection_failed', signed.nonce);
    }
    if (state.exchange_started || !state.processing_acquired) {
      return new Response('Connector authorization is still processing.', {
        status: 409, headers: { 'Retry-After': '2' },
      });
    }
  }
  let issued: ConnectorToken | null = null;
  let identity: { readonly accountId: string; readonly accountLabel: string } | null = null;
  let scopes: readonly string[] = [];
  let expiresAt: string | null = null;
  const now = dependencies.now();
  const exchangeAttemptKey = dependencies.newOperationKey();
  try {
    const started = await dependencies.startExchange(context.db, {
      p_state_id: state.state_id, p_consume_key: cookie.operationKey,
      p_processing_lease_token: state.processing_lease_token,
      p_exchange_attempt_key: exchangeAttemptKey, p_now: now.toISOString(),
    });
    if (!started) {
      return new Response('Connector authorization is still processing.', {
        status: 409, headers: { 'Retry-After': '2' },
      });
    }
  } catch (error) {
    return finish(request, provider, reportFailure(provider, error), signed.nonce);
  }
  try {
    issued = await dependencies.exchange(provider, code, cookie.verifier, callbackUrl);
    expiresAt = connectorTokenExpiryAt(provider, issued, now);
    identity = await dependencies.identity(provider, issued, identityHint.realmId ?? null);
    scopes = boundedConnectorScopes(await dependencies.resolveScopes(provider, issued));
    if (!dependencies.hasGrant(provider, scopes)) throw new ConnectorScopeError();
    if (!dependencies.providerReady(provider)) throw new ConnectorAvailabilityError();
    const credential = callbackCredential(issued, identity.accountId, now);
    await dependencies.complete(context.db, {
      brandId: state.brand_id, installationId: state.installation_id, provider,
      actorUserId: context.userId, completionKey: cookie.operationKey, credential,
      accountId: identity.accountId, accountLabel: identity.accountLabel,
      grantedScopes: scopes, expiresAt, identityHint,
    });
    return finish(request, provider, 'connected', signed.nonce);
  } catch (error) {
    const token = error instanceof ConnectorExchangeError
      ? error.issuedCredential ?? issued : issued;
    const owned = error instanceof ConnectorCompletionError && error.cleanup === 'queued';
    if (token && !owned) {
      try {
        const outcome = await ownIssuedCredential(
          context, state, provider, cookie.operationKey, token, identity, scopes,
          expiresAt ?? compensationTokenExpiryAt(provider, token, now),
          now, connectorCompensationReason(error),
          identityHint,
        );
        if (outcome === 'connected') return finish(request, provider, 'connected', signed.nonce);
      } catch (intakeError) {
        return finish(request, provider, reportFailure(provider, intakeError), signed.nonce);
      }
    }
    return finish(request, provider, reportFailure(provider, error), signed.nonce);
  }
}
