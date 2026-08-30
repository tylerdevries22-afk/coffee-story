/**
 * A fixed-window request counter, shared by every route that needs one.
 *
 * This began inside `operations-api.ts`, keyed on an authenticated user id.
 * The two routes that most need throttling have no user id to key on:
 * `/api/devices/pair` and `/api/devices/exchange` are unauthenticated by
 * necessity -- a tablet being paired holds no credential yet -- so the
 * credential presented in the body *is* the authentication, and a caller may
 * present as many candidates as we let them. Both files said in prose that
 * throttling "belongs at the edge, per IP"; nothing in this deployment
 * provides an edge, so it belonged nowhere.
 *
 * What this is and is not: a per-instance counter raises the cost of online
 * guessing by orders of magnitude and bounds a single caller's burst. It is
 * not a WAF. Serverless instances each hold their own map, so the effective
 * ceiling is the limit times the number of live instances, and a caller who
 * can forge the forwarded-for header keys into a fresh bucket at will. Treat
 * it as defence in depth under the short-lived, single-use pairing code and
 * the uniform error responses, not as the thing standing alone.
 */
const WINDOW_MS = 60_000;
const MAX_ENTRIES = 10_000;

type Bucket = { count: number; resetsAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Evicts expired entries, then the soonest-expiring ones if still at capacity.
 *
 * The second half matters: sweeping only what has expired leaves the map
 * unbounded when a flood arrives from many sources at once, which is exactly
 * the shape of the traffic a limiter is here for. Dropping a live bucket
 * forgives that caller's count, so the map is sized well above any honest
 * fleet and the eviction is a memory ceiling rather than a policy.
 */
function evict(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetsAt <= now) buckets.delete(key);
  }
  if (buckets.size < MAX_ENTRIES) return;
  const ordered = [...buckets.entries()].sort((a, b) => a[1].resetsAt - b[1].resetsAt);
  for (const [key] of ordered.slice(0, buckets.size - MAX_ENTRIES + 1)) buckets.delete(key);
}

/** True when this identity has already spent its budget for the window. */
export function rateLimited(
  identity: string,
  route: string,
  now = Date.now(),
  maximum = 60,
): boolean {
  if (buckets.size >= MAX_ENTRIES) evict(now);
  const key = `${identity}:${route}`;
  const current = buckets.get(key);
  if (!current || current.resetsAt <= now) {
    buckets.set(key, { count: 1, resetsAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > maximum;
}

/**
 * Whoever is calling, as well as an unauthenticated route can know it.
 *
 * `x-real-ip` first: the platform sets it to the socket peer, where
 * `x-forwarded-for` is a list a client can prepend to. Neither is
 * trustworthy on a deployment that terminates TLS somewhere else, hence the
 * caveat above. `unknown` is a real bucket rather than a bypass -- callers
 * arriving with no forwarded headers share one budget instead of skipping the
 * limiter entirely.
 */
export function clientIdentity(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || 'unknown';
}

/** Test seam: the map is module state and outlives a single test file. */
export function resetRateLimits(): void {
  buckets.clear();
}
