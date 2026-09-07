/** Bounded transport for server-side JSON integrations, including response bodies. */
export class ExternalRequestError extends Error {
  constructor(
    readonly code: 'timeout' | 'cancelled' | 'provider' | 'network',
    readonly status?: number,
    cause?: unknown,
  ) {
    const message = code === 'timeout' ? 'External provider request timed out.'
      : code === 'cancelled' ? 'External provider request cancelled.'
        : 'External provider request failed.';
    super(message, { cause });
    this.name = 'ExternalRequestError';
  }
}

async function retryDelay(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) throw new ExternalRequestError('cancelled');
  if (milliseconds === 0) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new ExternalRequestError('cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Mutations need provider idempotency keys: a provider can accept a request
 * before its response fails. A complete body is buffered before releasing the
 * deadline so JSON consumers cannot hang after receiving successful headers.
 */
export async function fetchExternalWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number; attempts?: number; retryDelayMs?: number } = {},
): Promise<Response> {
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? 10_000));
  const attempts = Math.max(2, Math.trunc(options.attempts ?? 2));
  const retryDelayMs = Math.max(0, Math.trunc(options.retryDelayMs ?? 250));
  const parentSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  let lastError = new ExternalRequestError('network');

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (parentSignal?.aborted) throw new ExternalRequestError('cancelled');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromParent = () => controller.abort();
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (response.status >= 500 || response.status === 429) {
        lastError = new ExternalRequestError('provider', response.status);
        await response.body?.cancel();
      } else {
        const body = response.body === null ? null : await response.arrayBuffer();
        const complete = new Response(body, {
          status: response.status, statusText: response.statusText, headers: response.headers,
        });
        // Response construction does not copy these read-only fetch metadata fields.
        Object.defineProperties(complete, {
          url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type },
        });
        return complete;
      }
    } catch (error) {
      if (parentSignal?.aborted) throw new ExternalRequestError('cancelled', undefined, error);
      lastError = new ExternalRequestError(controller.signal.aborted ? 'timeout' : 'network', undefined, error);
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
    if (attempt + 1 < attempts) await retryDelay(retryDelayMs, parentSignal);
  }
  throw lastError;
}
