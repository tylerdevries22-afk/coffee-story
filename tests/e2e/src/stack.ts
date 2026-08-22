/**
 * The E2E rig's environment: the supabase-CLI stack under test plus the
 * built app surfaces. The CI `e2e` job provides everything; without it the
 * whole suite SKIPS so `pnpm -r test` stays green anywhere.
 *
 *   SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY / _DB_URL   the stack
 *   E2E_CUSTOMER_DIR   customer `expo export` output (built with live env)
 *   E2E_OPERATOR_DIR   operator `expo export` output (built with live env)
 *   E2E_HQ_DIR         apps/hq with a completed `next build`
 *   MAILPIT_URL        the stack's mail catcher (OTP codes come from here)
 */
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

export const stack = {
  url: process.env.SUPABASE_TEST_URL ?? '',
  anonKey: process.env.SUPABASE_TEST_ANON_KEY ?? '',
  serviceRoleKey: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? '',
  dbUrl: process.env.SUPABASE_TEST_DB_URL ?? '',
  customerDir: process.env.E2E_CUSTOMER_DIR ?? '',
  operatorDir: process.env.E2E_OPERATOR_DIR ?? '',
  hqDir: process.env.E2E_HQ_DIR ?? '',
  mailpitUrl: process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324',
  shotDir: process.env.E2E_SHOT_DIR ?? '',
};

export const stackConfigured = Boolean(
  stack.url && stack.anonKey && stack.serviceRoleKey && stack.dbUrl
  && stack.customerDir && stack.operatorDir && stack.hqDir,
);

export const skipUnlessConfigured = stackConfigured
  ? false
  : 'no E2E stack (CI builds the exports and starts supabase; set SUPABASE_TEST_* and E2E_*_DIR to run locally)';

export function serviceClient(): SupabaseClient {
  return createClient(stack.url, stack.serviceRoleKey, { auth: { persistSession: false } });
}

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const client = new pg.Client({ connectionString: stack.dbUrl });
  await client.connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    await client.end();
  }
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@e2e.local`;
}
