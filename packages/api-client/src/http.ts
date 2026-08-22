/**
 * Retry-aware fetch, promoted verbatim from the apps' twin lib/network.ts.
 * Non-idempotent requests never retry unless they carry an Idempotency-Key —
 * which every write the platform API accepts does.
 */
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 2;
const SAFE_RETRY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class AppNetworkError extends Error {
  readonly code: 'timeout' | 'request_failed';

  constructor(code: AppNetworkError['code'], message: string) {
    super(message);
    this.name = 'AppNetworkError';
    this.code = code;
  }
}

export function requestCanRetry(init: RequestInit = {}): boolean {
  const method = (init.method ?? 'GET').toUpperCase();
  if (SAFE_RETRY_METHODS.has(method)) return true;
  return new Headers(init.headers).has('Idempotency-Key');
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  attempts = DEFAULT_ATTEMPTS,
): Promise<Response> {
  let finalError: unknown;
  const permittedAttempts = requestCanRetry(init) ? Math.max(2, attempts) : 1;
  for (let attempt = 0; attempt < permittedAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (response.ok || response.status < 500) return response;
      finalError = new Error(`Server returned ${response.status}`);
    } catch (error) {
      finalError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  const timedOut = finalError instanceof Error && finalError.name === 'AbortError';
  throw new AppNetworkError(
    timedOut ? 'timeout' : 'request_failed',
    timedOut ? 'The request took too long. Please try again.' : 'We could not complete that request.',
  );
}
