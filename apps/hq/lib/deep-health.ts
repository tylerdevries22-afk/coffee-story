import type { ServerEnv } from './api-auth';

export type HealthFetch = (input: string, init: RequestInit) => Promise<Response>;

export const REQUIRED_DATABASE_RELEASE = '20260828152200';

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
