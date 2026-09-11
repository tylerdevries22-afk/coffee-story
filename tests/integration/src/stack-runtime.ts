/**
 * Connection to the Supabase stack under test. The suite skips unless the
 * environment names an isolated database; CI provisions a disposable hosted
 * Supabase branch and exports these values before the run:
 *
 *   SUPABASE_TEST_URL                the API URL (http://127.0.0.1:54321)
 *   SUPABASE_TEST_ANON_KEY           anon key
 *   SUPABASE_TEST_SERVICE_ROLE_KEY   service-role key
 *   SUPABASE_TEST_DB_URL             direct Postgres URL (SQL-level asserts)
 */

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
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
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

/** Shared with `principal.ts`, which opens its own transaction-scoped client. */
export function databaseClient(): pg.Client {
  return new pg.Client({
    connectionString: stack.dbUrl,
    connectionTimeoutMillis: DATABASE_CONNECT_TIMEOUT_MS,
    query_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
    statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
  });
}

export const stack = {
  url: process.env.SUPABASE_TEST_URL ?? '',
  anonKey: process.env.SUPABASE_TEST_ANON_KEY ?? '',
  serviceRoleKey: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? '',
  dbUrl: process.env.SUPABASE_TEST_DB_URL ?? '',
};

export const stackConfigured = Boolean(stack.url && stack.anonKey && stack.serviceRoleKey && stack.dbUrl);

/** Every suite calls this in `describe(..., { skip })` so `pnpm -r test` stays green without a stack. */
export const skipUnlessConfigured = stackConfigured
  ? false
  : 'no hosted Supabase test branch (set SUPABASE_TEST_*; CI provisions one automatically)';

/**
 * Turn a silent skip into a failure where a skip would be a lie.
 *
 * `describe(..., { skip })` reports the suite as skipped but never registers
 * the tests inside it, so an unconfigured run prints `tests 0 / pass 0 /
 * fail 0` -- indistinguishable from a suite that ran and passed, and easy to
 * read as green in a long `pnpm verify` log. That is correct for a developer
 * without a database and dangerous anywhere the suites are the whole point.
 *
 * So the caller declares which it is. Set REQUIRE_DATABASE_TESTS=1 and a
 * missing stack fails loudly at import instead of skipping quietly; leave it
 * unset and the suites skip as before. CI's hosted-integration job sets it,
 * which is what makes "the RLS suite ran" a fact rather than an assumption.
 */
if (process.env.REQUIRE_DATABASE_TESTS === '1' && !stackConfigured) {
  const missing = Object.entries({
    SUPABASE_TEST_URL: stack.url,
    SUPABASE_TEST_ANON_KEY: stack.anonKey,
    SUPABASE_TEST_SERVICE_ROLE_KEY: stack.serviceRoleKey,
    SUPABASE_TEST_DB_URL: stack.dbUrl,
  }).filter(([, value]) => !value).map(([name]) => name);
  throw new Error(
    `REQUIRE_DATABASE_TESTS=1 but the test stack is not configured; missing ${missing.join(', ')}. `
    + 'These suites would have reported zero tests and looked green.',
  );
}

export function serviceClient(): SupabaseClient {
  return createClient(stack.url, stack.serviceRoleKey, supabaseOptions);
}

export function anonClient(): SupabaseClient {
  return createClient(stack.url, stack.anonKey, supabaseOptions);
}

/** A client whose PostgREST requests carry a real user's access token. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(stack.url, stack.anonKey, {
    auth: { persistSession: false },
    global: { fetch: resilientFetch, headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const client = databaseClient();
  await client.connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    await client.end();
  }
}
