import type { ServerEnv } from './api-auth';

export type HealthFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Who a probe asks as. The key decides what the database will answer, which
 * is the whole reason this is a parameter: the deep health route asks as the
 * service role, and anything rendered to a reader asks with the publishable
 * key so RLS is still the boundary. Two callers, one probe.
 */
export type HealthCredentials = Readonly<{ url: string; key: string }>;

/** The table read the deep probe uses: present on every deployment, tiny, RLS-gated. */
const DEFAULT_READ_PATH = 'brands?select=id&limit=1';

/**
 * The schema this build was verified against, as the release-readiness chain
 * reports it: the timestamp of the newest migration.
 *
 * Hand-maintained because the check runs on Vercel, where the migrations
 * directory is not in the bundle -- but not hand-trusted. `deep-health.test.ts`
 * derives the same value from `supabase/migrations` the way verify.yml does
 * and fails if the two ever part company. It had gone three releases stale
 * before that test existed, which would have answered 503 to every deep health
 * probe against a correctly migrated database.
 *
 * Equality, not a floor: `migrate-database` runs before `deploy-hq`, so the
 * database is never behind the code it is asked to serve.
 */
export const REQUIRED_DATABASE_RELEASE = '20260905093303';

function authHeaders(credentials: HealthCredentials): Record<string, string> {
  return { apikey: credentials.key, authorization: `Bearer ${credentials.key}` };
}

/**
 * One attempt under one deadline. The abort controller wraps the whole attempt
 * rather than each request, so a probe that reads and then asks for the release
 * spends one timeout between them, not two.
 */
async function attempt(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<boolean>,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch {
    // The caller retries once and then converts the failure into a 503 or an
    // outage row; a thrown fetch is indistinguishable from a refused one here.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `true` only means the REST edge answered this key. An empty result is a
 * healthy edge -- RLS returning no rows to `anon` is the boundary working, not
 * a dependency failing -- so the body is never read or forwarded anywhere.
 */
async function readsRows(
  credentials: HealthCredentials,
  path: string,
  fetcher: HealthFetch,
  signal: AbortSignal,
): Promise<boolean> {
  const response = await fetcher(new URL(`/rest/v1/${path}`, credentials.url).toString(), {
    method: 'GET',
    headers: authHeaders(credentials),
    signal,
  });
  return response.ok;
}

async function releaseMatches(
  credentials: HealthCredentials,
  fetcher: HealthFetch,
  signal: AbortSignal,
): Promise<boolean> {
  const response = await fetcher(
    new URL('/rest/v1/rpc/platform_release_readiness', credentials.url).toString(),
    {
      method: 'POST',
      headers: { ...authHeaders(credentials), 'content-type': 'application/json' },
      body: '{}',
      signal,
    },
  );
  return response.ok && await response.json() === REQUIRED_DATABASE_RELEASE;
}

/**
 * One bounded retry against the database REST edge used by every API route,
 * plus the release contract. Service-role only: `platform_release_readiness`
 * is revoked from `anon` and `authenticated`, so this cannot be a page's probe.
 */
export async function databaseHealthy(
  env: ServerEnv,
  fetcher: HealthFetch = fetch,
  timeoutMs = 5_000,
): Promise<boolean> {
  const credentials: HealthCredentials = { url: env.url, key: env.serviceRoleKey };
  for (let index = 0; index < 2; index += 1) {
    const healthy = await attempt(timeoutMs, async (signal) => {
      if (!await readsRows(credentials, DEFAULT_READ_PATH, fetcher, signal)) return false;
      return releaseMatches(credentials, fetcher, signal);
    });
    if (healthy) return true;
  }
  return false;
}

/**
 * The read half of the deep probe, for callers that must stay under RLS.
 *
 * Same edge, same bounded retry, same deadline -- only the key and the
 * resource differ. The status page uses this with the publishable key so a
 * public page can report a real dependency without a service-role read.
 */
export async function databaseReadable(
  credentials: HealthCredentials,
  path: string = DEFAULT_READ_PATH,
  fetcher: HealthFetch = fetch,
  timeoutMs = 5_000,
): Promise<boolean> {
  for (let index = 0; index < 2; index += 1) {
    if (await attempt(timeoutMs, (signal) => readsRows(credentials, path, fetcher, signal))) {
      return true;
    }
  }
  return false;
}
