import type { HealthResponse } from '@platform/api-client';

import { corsPreflight, jsonWithCors } from '../../../lib/api-auth';

/**
 * GET /api/health — liveness for uptime checks and the apps' reachability
 * probe. No database round-trip: this answers "is the deployment up", not
 * "is Supabase up".
 */
export function GET(): Response {
  const body: HealthResponse = {
    ok: true,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'dev',
  };
  return jsonWithCors(body);
}

/** Browser preflight for the customer web build. */
export function OPTIONS(): Response {
  return corsPreflight();
}
