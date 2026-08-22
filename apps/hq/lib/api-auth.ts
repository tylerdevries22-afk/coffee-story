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
import type { ApiErrorBody } from '@platform/api-client';
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
  return createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } });
}

/**
 * The API serves browsers too (the customer app's web build calls it from
 * its own origin), so every response carries CORS headers. `*` is safe here:
 * auth is a Bearer token, never a cookie, so no ambient credential rides a
 * cross-origin call.
 */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

/** Body parse that answers 400 instead of throwing on junk. */
export async function parseJsonBody<T>(request: Request): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return jsonError(400, 'invalid_request', 'The request body must be JSON.');
  }
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export function idempotencyKeyOf(request: Request): string | null {
  const key = request.headers.get('idempotency-key');
  if (!key) return null;
  return key.length <= MAX_IDEMPOTENCY_KEY_LENGTH ? key : key.slice(0, MAX_IDEMPOTENCY_KEY_LENGTH);
}

export type CustomerIdentity = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  sms_opt_in: boolean;
};

/**
 * The caller's customers row for their brand, created on first contact so a
 * guest's first order does not require a separate profile step.
 */
export async function resolveCustomer(
  db: SupabaseClient,
  auth: AuthedRequest,
): Promise<CustomerIdentity> {
  const existing = await db
    .from('customers')
    .select('id, full_name, email, phone, sms_opt_in')
    .eq('brand_id', auth.claims.brand_id)
    .eq('user_id', auth.userId)
    .maybeSingle<CustomerIdentity>();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;
  const created = await db
    .from('customers')
    .insert({
      brand_id: auth.claims.brand_id,
      user_id: auth.userId,
      full_name: '',
      email: auth.email,
    })
    .select('id, full_name, email, phone, sms_opt_in')
    .single<CustomerIdentity>();
  if (created.error) {
    // Two first-contact requests raced; the UNIQUE (brand_id, user_id) kept one.
    if (created.error.code === '23505') {
      const winner = await db
        .from('customers')
        .select('id, full_name, email, phone, sms_opt_in')
        .eq('brand_id', auth.claims.brand_id)
        .eq('user_id', auth.userId)
        .single<CustomerIdentity>();
      if (!winner.error) return winner.data;
    }
    throw created.error;
  }
  return created.data;
}
