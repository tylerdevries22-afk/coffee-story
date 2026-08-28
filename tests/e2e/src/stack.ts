/**
 * The E2E rig's environment: the supabase-CLI stack under test plus the
 * built app surfaces. The CI `e2e` job provides everything; without it the
 * whole suite SKIPS so `pnpm -r test` stays green anywhere.
 *
 *   SUPABASE_TEST_URL / _ANON_KEY / _SERVICE_ROLE_KEY / _DB_URL   the stack
 *   E2E_CUSTOMER_DIR   customer `expo export` output (built with live env)
 *   E2E_OPERATOR_DIR   operator `expo export` output (built with live env)
 *   E2E_HQ_DIR         apps/hq with a completed `next build`
 */
import { randomUUID } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

const DATABASE_CONNECT_TIMEOUT_MS = 10_000;
const DATABASE_STATEMENT_TIMEOUT_MS = 30_000;
const HTTP_TIMEOUT_MS = 15_000;
const HTTP_MAX_ATTEMPTS = 2;

function retryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let latestError: unknown;
  for (let attempt = 1; attempt <= HTTP_MAX_ATTEMPTS; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(HTTP_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await fetch(input, { ...init, signal });
      if (attempt === HTTP_MAX_ATTEMPTS || !retryableStatus(response.status)) return response;
      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      latestError = error;
      if (attempt === HTTP_MAX_ATTEMPTS) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
  }
  throw latestError instanceof Error ? latestError : new Error('Supabase request failed');
}

const supabaseOptions = {
  auth: { persistSession: false },
  global: { fetch: resilientFetch },
} as const;

export const stack = {
  url: process.env.SUPABASE_TEST_URL ?? '',
  anonKey: process.env.SUPABASE_TEST_ANON_KEY ?? '',
  serviceRoleKey: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? '',
  dbUrl: process.env.SUPABASE_TEST_DB_URL ?? '',
  customerDir: process.env.E2E_CUSTOMER_DIR ?? '',
  operatorDir: process.env.E2E_OPERATOR_DIR ?? '',
  hqDir: process.env.E2E_HQ_DIR ?? '',
  shotDir: process.env.E2E_SHOT_DIR ?? '',
};

export const stackConfigured = Boolean(
  stack.url && stack.anonKey && stack.serviceRoleKey && stack.dbUrl
  && stack.customerDir && stack.operatorDir && stack.hqDir,
);

export const skipUnlessConfigured = stackConfigured
  ? false
  : 'no E2E stack (CI builds against a hosted Supabase branch; set SUPABASE_TEST_* and E2E_*_DIR to run manually)';

export function serviceClient(): SupabaseClient {
  return createClient(stack.url, stack.serviceRoleKey, supabaseOptions);
}

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const client = new pg.Client({
    connectionString: stack.dbUrl,
    connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
    query_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
    statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
  });
  await client.connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    await client.end();
  }
}

export function uniqueEmail(prefix: string): string {
  // GoTrue's public OTP boundary rejects special-use local TLDs. example.com
  // is reserved for documentation/testing and still exercises real email
  // validation without risking delivery to an owned address.
  return `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
}
