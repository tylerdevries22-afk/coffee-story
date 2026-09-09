import { createMcpOAuthMaterial } from 'franchise-mcp-store-ui/oauth';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  connectorAuthorizationUrl,
  connectorCallbackUrl,
  connectorProviderReady,
  connectorProviderScopes,
  isOAuthConnectorKey,
} from './connector-oauth-providers';
import {
  authorizeConnectorOAuth,
  connectorCookieName,
  connectorStateSecret,
} from './connector-oauth-route';
import { connectorRpc } from './connector-rpc';

function beginConnectorOAuthState(
  db: SupabaseClient,
  args: Readonly<Record<string, unknown>>,
) {
  return connectorRpc(db, 'begin_connector_oauth_state', args);
}

/** Mutable seams let route tests execute the exported GET handler. */
export const connectorOAuthAuthorizeDependencies = {
  authorizationUrl: connectorAuthorizationUrl,
  authorize: authorizeConnectorOAuth,
  beginState: beginConnectorOAuthState,
  callbackUrl: connectorCallbackUrl,
  cookieName: connectorCookieName,
  createMaterial: createMcpOAuthMaterial,
  isProvider: isOAuthConnectorKey,
  now: () => new Date(),
  providerReady: connectorProviderReady,
  randomUuid: () => crypto.randomUUID(),
  scopes: connectorProviderScopes,
  stateSecret: connectorStateSecret,
};
