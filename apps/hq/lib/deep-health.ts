import type { ServerEnv } from './api-auth';

export type HealthFetch = (input: string, init: RequestInit) => Promise<Response>;

/** One bounded retry against the database REST edge used by every API route. */
export async function databaseHealthy(
  env: ServerEnv,
  fetcher: HealthFetch = fetch,
  timeoutMs = 5_000,
): Promise<boolean> {
  const url = new URL('/rest/v1/brands?select=id&limit=1', env.url).toString();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, {
        method: 'GET',
        headers: { apikey: env.serviceRoleKey, authorization: `Bearer ${env.serviceRoleKey}` },
        signal: controller.signal,
      });
      if (response.ok) return true;
    } catch {
      // Retry once; the caller converts the final failure into a 503.
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}
