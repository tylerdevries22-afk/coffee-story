import type { SupabaseClient } from '@supabase/supabase-js';

import type { BrandRole } from '@platform/schema';

import {
  authenticate,
  authenticatedDb,
  jsonError,
  serverEnv,
  serviceDb,
  type AuthedRequest,
} from './api-auth';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ENTRIES = 10_000;

type RateLimitBucket = { count: number; resetsAt: number };
const rateLimitBuckets = new Map<string, RateLimitBucket>();

export type OperationsRequestContext = {
  auth: AuthedRequest;
  db: SupabaseClient;
};

export function validUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function boundedText(value: unknown, maximum: number, required = false): string | null {
  if (typeof value !== 'string') return required ? null : '';
  const normalized = value.trim();
  if ((required && normalized.length === 0) || normalized.length > maximum) return null;
  return normalized;
}

export function roleAtLeast(role: BrandRole | undefined, required: BrandRole): boolean {
  const rank: Record<BrandRole, number> = {
    staff: 0,
    location_manager: 1,
    brand_owner: 2,
    platform_admin: 3,
  };
  return role !== undefined && rank[role] >= rank[required];
}

/**
 * A bounded per-identity burst guard. Database authorization remains the
 * security boundary; this protects route capacity before a mutation reaches
 * Postgres. Vercel instances enforce their own window, while database RPCs
 * still provide idempotency and transaction-level contention protection.
 */
export function operationsRateLimited(
  identity: string,
  route: string,
  now = Date.now(),
  maximum = 60,
): boolean {
  if (rateLimitBuckets.size >= RATE_LIMIT_MAX_ENTRIES) {
    for (const [key, bucket] of rateLimitBuckets) {
      if (bucket.resetsAt <= now) rateLimitBuckets.delete(key);
    }
  }
  const key = `${identity}:${route}`;
  const current = rateLimitBuckets.get(key);
  if (!current || current.resetsAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetsAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > maximum;
}

export function validIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function validOperationsRange(
  from: string | null,
  to: string | null,
  now = new Date(),
): { from: string; to: string } | null {
  const start = from ?? new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const end = to ?? new Date(now.getTime() + 35 * 24 * 60 * 60 * 1_000).toISOString();
  if (!validIsoInstant(start) || !validIsoInstant(end)) return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (endMs <= startMs || endMs - startMs > 36 * 24 * 60 * 60 * 1_000) return null;
  return { from: new Date(startMs).toISOString(), to: new Date(endMs).toISOString() };
}

export async function operationsRequestContext(
  request: Request,
  minimumRole: BrandRole = 'staff',
): Promise<OperationsRequestContext | Response> {
  const env = serverEnv();
  if (!env) return jsonError(501, 'not_configured', 'This deployment has no Supabase configuration.');
  const service = serviceDb(env);
  const auth = await authenticate(request, service);
  if (auth instanceof Response) return auth;
  if (!roleAtLeast(auth.claims.role, minimumRole)) {
    return jsonError(403, 'forbidden', 'This operation is not available to your tenant role.');
  }
  if (operationsRateLimited(auth.userId, new URL(request.url).pathname)) {
    return jsonError(429, 'rate_limited', 'Too many operations requests. Try again shortly.');
  }
  const feature = await service.from('brands').select('operations')
    .eq('id', auth.claims.brand_id).maybeSingle<{ operations: boolean }>();
  if (feature.error) return jsonError(503, 'operations_unavailable', 'Operations are temporarily unavailable.');
  if (!feature.data?.operations) {
    return jsonError(404, 'operations_disabled', 'Operations are not enabled for this tenant.');
  }
  const db = authenticatedDb(env, request);
  if (!db) return jsonError(401, 'unauthorized', 'Send a Supabase access token as a Bearer token.');
  return { auth, db };
}

export function operationDatabaseError(error: { code?: string; message?: string } | null): Response {
  const message = error?.message ?? '';
  if (error?.code === '42501' || message.includes('not_accessible') || message.includes('manager_required')) {
    return jsonError(403, 'forbidden', 'You do not have access to that operation.');
  }
  if (message.includes('eligibility_required')) {
    return jsonError(409, 'ineligible', 'Required role, shift, or training eligibility is missing.');
  }
  if (message.includes('not_claimable') || message.includes('not_owned')
    || message.includes('action_id_conflict')) {
    return jsonError(409, 'conflict', 'That operation changed. Refresh it and try again.');
  }
  if (error?.code === '22023' || message.includes('_invalid') || message.includes('_required')) {
    return jsonError(400, 'invalid_request', 'Review the operation details and try again.');
  }
  if (error?.code === '23505') {
    return jsonError(409, 'conflict', 'That operation already exists.');
  }
  return jsonError(503, 'operations_unavailable', 'Operations are temporarily unavailable.');
}
