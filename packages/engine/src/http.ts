/**
 * Bounded transport for server-side integrations.
 *
 * A provider can fail after accepting a request, so callers that mutate
 * remote state must include their provider idempotency key. The helper still
 * retries one transient response for every integration, while never looping
 * on a client error.
 */
export async function fetchExternalWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number; attempts?: number; retryDelayMs?: number } = {},
): Promise<Response> {
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? 10_000));
  const attempts = Math.max(2, Math.trunc(options.attempts ?? 2));
  const retryDelayMs = Math.max(0, Math.trunc(options.retryDelayMs ?? 250));
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const parentSignal = init.signal;
    const abortFromParent = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort();
      else parentSignal.addEventListener('abort', abortFromParent, { once: true });
    }
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (response.status < 500 && response.status !== 429) return response;
      lastError = new Error(`External provider returned ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
    if (attempt + 1 < attempts && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  const timedOut = lastError instanceof Error && lastError.name === 'AbortError';
  throw new Error(timedOut ? 'External provider request timed out.' : 'External provider request failed.');
}
