/**
 * The platform API's shared edge: env, service-role client, bearer-token
 * verification, and the one error-body shape every route returns
 * (ApiErrorBody from @platform/api-client, so client and server cannot
 * disagree about what an error looks like).
 *
 * Env is read per-request, never at module top level: routes must be
 * importable by the in-process integration tests, which set the env first,
 * and must degrade to 501 on an unconfigured deployment instead of crashing
 * the build. Imports are relative (no `@/` alias) for the same reason.
 */
import { timingSafeEqual } from 'node:crypto';

import { fetchWithRetry, type ApiErrorBody } from '@platform/api-client';
import { parseTenantClaims, type TenantClaims } from '@platform/schema';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ServerEnv = {
  url: string;
  serviceRoleKey: string;
};

export function serverEnv(): ServerEnv | null {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

export function serviceDb(env: ServerEnv): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetchWithRetry(input, init) },
  });
}

/**
 * A PostgREST client that keeps the caller's verified bearer token attached.
 *
 * API routes use the service client only to verify the token and read public
 * tenant feature flags. Tenant mutations must run through this client so
 * `auth.uid()` and RLS remain the source of authorization truth.
 */
export function authenticatedDb(env: ServerEnv, request: Request): SupabaseClient | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false },
    global: {
      headers: { Authorization: authorization },
      fetch: (input, init) => fetchWithRetry(input, init),
    },
  });
}

/**
 * The API serves browsers too (the customer app's web build calls it from
 * its own origin), so every response carries CORS headers. `*` is safe here:
 * auth is a Bearer token, never a cookie, so no ambient credential rides a
 * cross-origin call.
 */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'DELETE, GET, PATCH, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, idempotency-key',
  'Access-Control-Max-Age': '86400',
} as const;

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonWithCors(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

export function jsonError(status: number, code: string, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status, headers: CORS_HEADERS });
}

/**
 * Constant-time comparison for a shared secret. `!==` on strings returns at
 * the first differing byte, which is a timing oracle: an attacker who can
 * measure the difference recovers the secret one character at a time.
 * Length is compared first because timingSafeEqual throws on a mismatch —
 * that leak is only the length, which the format already implies.
 */
export function matchesSecret(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const given = Buffer.from(provided);
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

export const notConfigured = (): Response =>
  jsonError(501, 'not_configured', 'This deployment has no Supabase configuration.');

export type AuthedRequest = {
  userId: string;
  email: string | null;
  claims: TenantClaims;
};

/**
 * Verifies the caller's Supabase access token and returns the tenancy claims
 * the auth hook minted into it. Verification goes through GoTrue (signature +
 * expiry + revocation); the claims are then read from the token payload
 * itself — auth.getUser returns the app_metadata STORED on the user, which
 * never contains hook-minted claims.
 */
export async function authenticate(
  request: Request,
  db: SupabaseClient,
): Promise<AuthedRequest | Response> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) return jsonError(401, 'unauthorized', 'Send a Supabase access token as a Bearer token.');
  const verified = await db.auth.getUser(token);
  if (verified.error || !verified.data.user) {
    return jsonError(401, 'unauthorized', 'That access token is not valid.');
  }
  let payload: { app_metadata?: unknown };
  try {
    payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      app_metadata?: unknown;
    };
  } catch {
    return jsonError(401, 'unauthorized', 'That access token is not valid.');
  }
  const claims = parseTenantClaims(payload.app_metadata);
  if (!claims) {
    return jsonError(403, 'no_tenant', 'This account belongs to no brand yet. Sign in through a brand app.');
  }
  return { userId: verified.data.user.id, email: verified.data.user.email ?? null, claims };
}

/**
 * A caller that may be a PERSON or a paired DEVICE.
 *
 * `authenticate` above is deliberately left alone. Six routes call it --
 * loyalty redeem, profile, push tokens, referrals, order cancel, order refund
 * -- and every one of them must stay users-only. Widening it would opt all six
 * into device access by default, which is the wrong direction for a default:
 * the platform should be users-only unless a route says otherwise, and exactly
 * one route (POST /api/orders) says otherwise.
 */
/** Body parse that answers 400 instead of throwing on junk. */
export async function parseJsonBody<T>(request: Request): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return jsonError(400, 'invalid_request', 'The request body must be JSON.');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A well-formed key, or null. `false` when one was sent and is unusable. */
export function idempotencyKeyOf(request: Request): string | null | false {
  const key = request.headers.get('idempotency-key');
  if (!key) return null;
  // orders.client_key is a uuid column, so anything else reached Postgres as
  // 22P02 and surfaced as a 500 — the client's malformed header reported as
  // the server's fault. Truncating to 200 characters was worse than useless
  // for a uuid column, and for the redeem note it could make two distinct
  // keys share a prefix and count as one redemption.
  return UUID.test(key) ? key.toLowerCase() : false;
}

export { authenticateAny } from './api-device-auth';
export type { Caller } from './api-device-auth';
export { resolveCustomer } from './api-customer';
export type { CustomerIdentity } from './api-customer';
