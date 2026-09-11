import { mcpSha256 } from 'franchise-mcp-store-ui/oauth';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  connectorCallbackUrl,
  connectorProviderReady,
  exchangeConnectorCode,
  hasCompleteConnectorGrant,
  isOAuthConnectorKey,
  resolveGrantedScopes,
  verifyConnectorIdentity,
} from './connector-oauth-providers';
import { completeConnectorOAuth } from './connector-oauth-completion';
import { queueConnectorOAuthCompensation } from './connector-oauth-compensation';
import {
  authorizeConnectorOAuth,
  connectorCookieName,
  parseConnectorCookie,
  verifyConnectorState,
} from './connector-oauth-route';
import { connectorRpc } from './connector-rpc';

async function consumeConnectorOAuthState(
  db: SupabaseClient,
  args: Readonly<Record<string, unknown>>,
) {
  let last;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      last = await connectorRpc(db, 'consume_connector_oauth_state', args);
      if (!last.error) return last;
    } catch {
      if (attempt > 0) throw new Error('Connector OAuth state storage failed.');
    }
  }
  return last ?? { data: null, error: true };
}

async function stableBooleanRpc(
  db: SupabaseClient,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await connectorRpc(db, name, args);
      if (!result.error && typeof result.data === 'boolean') return result.data;
    } catch { /* retry only the stable exchange-attempt key */ }
  }
  throw new Error('Connector OAuth exchange storage failed.');
}

async function startConnectorOAuthCodeExchange(
  db: SupabaseClient,
  args: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  for (let cycle = 0; cycle < 2; cycle += 1) {
    try {
      return await stableBooleanRpc(db, 'start_connector_oauth_code_exchange', args);
    } catch {
      const cancelled = await stableBooleanRpc(
        db, 'cancel_connector_oauth_code_exchange', args,
      );
      if (!cancelled) throw new Error('Connector OAuth exchange storage failed.');
    }
  }
  throw new Error('Connector OAuth exchange storage failed.');
}

/** Mutable seams let route tests exercise the exported GET handler directly. */
export const connectorOAuthCallbackDependencies = {
  authorize: authorizeConnectorOAuth,
  callbackUrl: connectorCallbackUrl,
  compensate: queueConnectorOAuthCompensation,
  complete: completeConnectorOAuth,
  consumeState: consumeConnectorOAuthState,
  cookieName: connectorCookieName,
  exchange: exchangeConnectorCode,
  hasGrant: hasCompleteConnectorGrant,
  identity: verifyConnectorIdentity,
  isProvider: (candidate: string) => isOAuthConnectorKey(candidate),
  newOperationKey: () => crypto.randomUUID(),
  now: () => new Date(),
  parseCookie: parseConnectorCookie,
  providerReady: connectorProviderReady,
  resolveScopes: resolveGrantedScopes,
  sha256: mcpSha256,
  startExchange: startConnectorOAuthCodeExchange,
  verifyState: verifyConnectorState,
};
