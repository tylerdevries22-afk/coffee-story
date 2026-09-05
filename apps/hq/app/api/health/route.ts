import type { HealthResponse } from '@platform/api-client';

import { corsPreflight, jsonWithCors, matchesSecret, serverEnv } from '../../../lib/api-auth';
import { databaseHealthy } from '../../../lib/deep-health';

/**
 * GET /api/health — liveness for uptime checks and the apps' reachability
 * probe. `?deep=1` is authenticated for synthetics and checks the database
 * dependency rather than accepting a redirect to the login page as healthy.
 */
export async function GET(request: Request): Promise<Response> {
  const body: HealthResponse & { tenant: string } = {
    ok: true,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'dev',
    tenant: process.env.TENANT ?? '',
  };
  const deep = new URL(request.url).searchParams.get('deep') === '1';
  if (!deep) return jsonWithCors(body);

  const expected = process.env.HEALTH_CHECK_TOKEN;
  if (!expected) return jsonWithCors({ ok: false, error: 'Deep health is not configured.' }, 501);
  if (!matchesSecret(request.headers.get('x-health-check-token'), expected)) {
    return jsonWithCors({ ok: false, error: 'Deep health token rejected.' }, 401);
  }
  const env = serverEnv();
  if (!env) return jsonWithCors({ ok: false, error: 'Database is not configured.' }, 503);
  if (!await databaseHealthy(env)) {
    return jsonWithCors({ ok: false, error: 'Database read failed.' }, 503);
  }
  return jsonWithCors(body);
}

/** Browser preflight for the customer web build. */
export function OPTIONS(): Response {
  return corsPreflight();
}
