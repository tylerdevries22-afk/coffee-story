/** Bounded transport for server-side JSON integrations, including response bodies. */
export class ExternalRequestError extends Error {
  constructor(
    readonly code: 'timeout' | 'cancelled' | 'provider' | 'network' | 'response_too_large',
    readonly status?: number,
    cause?: unknown,
  ) {
    const message = code === 'timeout' ? 'External provider request timed out.'
      : code === 'cancelled' ? 'External provider request cancelled.'
        : code === 'response_too_large' ? 'External provider response was too large.'
        : 'External provider request failed.';
    super(message, { cause });
    this.name = 'ExternalRequestError';
  }
}

async function readBoundedBody(response: Response, maximum: number): Promise<ArrayBuffer | null> {
  if (response.body === null) return null;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) {
    try { await response.body.cancel(); } catch { /* preserve the size failure */ }
    throw new ExternalRequestError('response_too_large', response.status);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > maximum) {
      try { await reader.cancel(); } catch { /* preserve the size failure */ }
      throw new ExternalRequestError('response_too_large', response.status);
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
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

function boundedOption(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

/**
 * Non-idempotent sends select rejected-only: retry explicit429 rejections, never
 * ambiguous network failures, body timeouts or5xx responses. Other mutations
 * need provider idempotency keys: a provider can accept a request
 * before its response fails. A complete body is buffered before releasing the
 * deadline so JSON consumers cannot hang after receiving successful headers.
 */
export async function fetchExternalWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: {
    timeoutMs?: number;
    attempts?: number;
    retryDelayMs?: number;
    retryMode?: 'idempotent' | 'rejected-only';
    maxResponseBytes?: number;
  } = {},
): Promise<Response> {
  const timeoutMs = boundedOption(options.timeoutMs, 10_000, 1, 120_000);
  const attempts = boundedOption(options.attempts, 2, 1, 5);
  const retryDelayMs = boundedOption(options.retryDelayMs, 250, 0, 60_000);
  const maxResponseBytes = boundedOption(options.maxResponseBytes, 1_048_576, 1, 134_217_728);
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
      if (response.status === 429 || (options.retryMode !== 'rejected-only' && response.status >= 500)) {
        lastError = new ExternalRequestError('provider', response.status);
        await response.body?.cancel();
      } else {
        const body = await readBoundedBody(response, maxResponseBytes);
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
      if (error instanceof ExternalRequestError && error.code === 'response_too_large') throw error;
      lastError = new ExternalRequestError(controller.signal.aborted ? 'timeout' : 'network', undefined, error);
      if (options.retryMode === 'rejected-only') throw lastError;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
    if (attempt + 1 < attempts) await retryDelay(retryDelayMs, parentSignal);
  }
  throw lastError;
}
