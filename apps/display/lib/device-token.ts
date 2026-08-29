/**
 * The token this screen reads the board with.
 *
 * A display is hardware nobody signs into, and until now its credential was a
 * twelve-hour JWT pasted into DISPLAY_DEVICE_TOKEN at deploy time. That has a
 * fixed end: twelve hours after the deploy the board stops resolving and the
 * only remedy is a human editing an environment variable, which on a wall in a
 * shop means the queue goes dark until somebody notices.
 *
 * So the durable credential is a refresh secret, and the token is derived from
 * it on demand. The secret is long-lived and revocable in one column; the token
 * stays short so a screen that is stolen or unplugged still dies the same day.
 *
 * DISPLAY_DEVICE_TOKEN keeps working when no secret is configured. That is
 * deliberate: the two can be rolled out in either order, and no deployment has
 * to have both set at the same instant to stay up.
 */
const REFRESH_TIMEOUT_MS = 8_000;
const REFRESH_ATTEMPTS = 3;
/** Refresh this far before expiry, so a slow exchange never races the clock. */
const EXPIRY_SKEW_MS = 5 * 60_000;
/** After a failure, do not hammer HQ from a screen that will retry forever. */
const FAILURE_BACKOFF_MS = 30_000;

type Cached = { token: string; expiresAtMs: number };

export type DeviceTokenEnvironment = Readonly<{
  staticToken: string | undefined;
  refreshSecret: string | undefined;
  hqOrigin: string | undefined;
}>;

export type DeviceTokenDependencies = Readonly<{
  fetcher?: typeof fetch;
  now?: () => number;
  environment?: DeviceTokenEnvironment;
}>;

function productionEnvironment(): DeviceTokenEnvironment {
  return {
    staticToken: process.env.DISPLAY_DEVICE_TOKEN,
    refreshSecret: process.env.DISPLAY_DEVICE_REFRESH_SECRET,
    hqOrigin: process.env.HQ_ORIGIN,
  };
}

let cached: Cached | null = null;
let inFlight: Promise<string | null> | null = null;
let nextAttemptAtMs = 0;

/** Test seam. Module state is process-wide, so a test must be able to clear it. */
export function resetDeviceTokenCache(): void {
  cached = null;
  inFlight = null;
  nextAttemptAtMs = 0;
}

async function exchange(
  environment: DeviceTokenEnvironment,
  fetcher: typeof fetch,
  nowMs: number,
): Promise<string | null> {
  const { refreshSecret, hqOrigin } = environment;
  if (!refreshSecret || !hqOrigin) return null;

  let endpoint: string;
  try { endpoint = new URL('/api/devices/exchange', hqOrigin).toString(); }
  catch { return null; }

  for (let attempt = 1; attempt <= REFRESH_ATTEMPTS; attempt += 1) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REFRESH_TIMEOUT_MS);
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ secret: refreshSecret }),
        signal: abort.signal,
        cache: 'no-store',
      });
      // A rejected secret will be rejected again in eight seconds. Only a
      // transport fault or a server fault is worth another attempt.
      if (response.status >= 400 && response.status < 500) break;
      if (response.ok) {
        const body = await response.json() as { token?: unknown; expiresAt?: unknown };
        const token = typeof body.token === 'string' ? body.token : '';
        const expiresAtMs = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
        if (token && Number.isFinite(expiresAtMs)) {
          cached = { token, expiresAtMs };
          return token;
        }
        break;
      }
    } catch {
      // Timeout or network fault. Falls through to the retry.
    } finally {
      clearTimeout(timer);
    }
    if (attempt < REFRESH_ATTEMPTS) {
      await new Promise((resolve) => { setTimeout(resolve, attempt * 500); });
    }
  }
  // Every failing path lands here, revoked secrets included: a screen that just
  // failed must not ask again on the next render, or a revoked one polls HQ for
  // as long as it stays plugged in.
  nextAttemptAtMs = nowMs + FAILURE_BACKOFF_MS;
  return null;
}

/**
 * The current device token, refreshing it when it is close to expiring.
 *
 * Single-flight: a board render, an SSE connection and a telemetry write can
 * all ask at once on boot, and exactly one exchange goes to HQ.
 */
export async function deviceToken(
  dependencies: DeviceTokenDependencies = {},
): Promise<string | null> {
  const environment = dependencies.environment ?? productionEnvironment();
  const nowMs = dependencies.now?.() ?? Date.now();
  const fetcher = dependencies.fetcher ?? fetch;

  if (cached && cached.expiresAtMs - EXPIRY_SKEW_MS > nowMs) return cached.token;

  if (environment.refreshSecret && environment.hqOrigin) {
    if (nowMs >= nextAttemptAtMs) {
      inFlight ??= exchange(environment, fetcher, nowMs).finally(() => { inFlight = null; });
      const token = await inFlight;
      if (token) return token;
    }
    // A stale-but-unexpired token beats no board at all while HQ is unreachable.
    if (cached && cached.expiresAtMs > nowMs) return cached.token;
  }

  return environment.staticToken ?? null;
}

/**
 * Whether this screen has any credential at all.
 *
 * Cheap and synchronous, for the paths that only need to tell a configured
 * deployment from an unpaired one and must not make a network call to do it.
 */
export function deviceTokenConfigured(
  environment: DeviceTokenEnvironment = productionEnvironment(),
): boolean {
  return Boolean(environment.staticToken)
    || Boolean(environment.refreshSecret && environment.hqOrigin);
}
