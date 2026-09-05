import 'server-only';

import {
  mcpOAuthCookieName,
  type McpOAuthState,
  verifyMcpOAuthState,
} from 'franchise-mcp-store-ui/oauth';
import type { SupabaseClient } from '@supabase/supabase-js';

import { currentSession, hasRole } from './auth';
import { clientIdentity, rateLimited } from './rate-limit';
import { serverEnv, serviceDb } from './api-auth';
import { isConfigured } from './supabase-server';
import { selectedOrganizationId } from './workspace-scope';
import type { OAuthConnectorKey } from './connector-oauth-providers';

export type ConnectorOAuthContext = {
  readonly brandId: string;
  readonly db: SupabaseClient;
  readonly userId: string;
};

export type ConnectorOAuthCookie = {
  readonly binding: string;
  readonly verifier: string;
};

export function connectorStateSecret(): string {
  return process.env.CONNECTOR_OAUTH_STATE_SECRET?.trim() ?? '';
}

export function connectorCookieName(key: OAuthConnectorKey): string {
  return mcpOAuthCookieName(key, 'hq_connector_oauth');
}

export function parseConnectorCookie(request: Request, key: OAuthConnectorKey): ConnectorOAuthCookie | null {
  const name = connectorCookieName(key);
  const raw = request.headers.get('cookie')?.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(decodeURIComponent(raw), 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object') return null;
    const binding = Reflect.get(value, 'binding'); const verifier = Reflect.get(value, 'verifier');
    if (typeof binding !== 'string' || binding.length < 32 || binding.length > 100
      || typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128) return null;
    return { binding, verifier };
  } catch { return null; }
}

export function verifyConnectorState(
  rawState: string,
  key: OAuthConnectorKey,
): McpOAuthState | null {
  return verifyMcpOAuthState(rawState, key, connectorStateSecret());
}

export async function authorizeConnectorOAuth(
  request: Request,
  requireSelectedBrand = true,
): Promise<ConnectorOAuthContext | Response> {
  if (rateLimited(clientIdentity(request), 'connector-oauth', Date.now(), 30)) {
    return new Response('Too many connector authorization attempts.', { status: 429 });
  }
  if (!isConfigured()) return new Response('Connector authorization is not configured.', { status: 503 });
  const environment = serverEnv();
  const session = await currentSession();
  if (!environment || !session?.userId) return new Response('Sign in to connect this provider.', { status: 401 });
  if (!hasRole(session, 'brand_owner')) {
    return new Response('Only an organization owner can connect this provider.', { status: 403 });
  }
  return {
    brandId: requireSelectedBrand ? await selectedOrganizationId(session) : session.brandId,
    db: serviceDb(environment),
    userId: session.userId,
  };
}
