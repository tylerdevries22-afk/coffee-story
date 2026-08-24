export type DataReadResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

export type DataReadOptions = {
  timeoutMs?: number;
  attempts?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ATTEMPTS = 2;

/**
 * Supabase queries resolve errors instead of rejecting them, so the usual
 * network retry wrapper cannot see a failed read. This boundary gives every
 * storefront read a deadline and one retry while aborting the request that
 * missed its deadline.
 */
export async function readWithRetry<T>(
  operation: string,
  read: (signal: AbortSignal) => PromiseLike<DataReadResult<T>>,
  options: DataReadOptions = {},
): Promise<T | null> {
  const attempts = Math.max(2, Math.trunc(options.attempts ?? DEFAULT_ATTEMPTS));
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  let detail = 'The read failed.';

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await read(controller.signal);
      if (!result.error) return result.data;
      detail = result.error.message;
    } catch (error) {
      detail = error instanceof Error ? error.message : 'The read failed.';
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`${operation}: ${detail}`);
}
