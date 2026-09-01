import type { ServerEnv } from './api-auth';

export type HealthFetch = (input: string, init: RequestInit) => Promise<Response>;

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
export const REQUIRED_DATABASE_RELEASE = '20260901060421';

/** One bounded retry against the database REST edge used by every API route. */
export async function databaseHealthy(
  env: ServerEnv,
  fetcher: HealthFetch = fetch,
  timeoutMs = 5_000,
): Promise<boolean> {
  const readUrl = new URL('/rest/v1/brands?select=id&limit=1', env.url).toString();
  const releaseUrl = new URL('/rest/v1/rpc/platform_release_readiness', env.url).toString();
  const headers = {
    apikey: env.serviceRoleKey,
    authorization: `Bearer ${env.serviceRoleKey}`,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const read = await fetcher(readUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      if (!read.ok) continue;
      const release = await fetcher(releaseUrl, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      });
      if (release.ok && await release.json() === REQUIRED_DATABASE_RELEASE) return true;
    } catch {
      // Retry once; the caller converts the final failure into a 503.
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}
