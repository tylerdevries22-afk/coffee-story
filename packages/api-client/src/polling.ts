/**
 * Start an immediate poll whose next run is scheduled only after the current
 * one settles. Slow retries therefore cannot overlap and apply stale results
 * after a newer read.
 */
export function startSerializedPolling(
  task: () => Promise<void>,
  intervalMs: number,
): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = async () => {
    try {
      await task();
    } catch {
      // Poll tasks own their user-facing failure state; the next read retries.
    } finally {
      if (active) timer = setTimeout(() => void run(), intervalMs);
    }
  };

  void run();
  return () => {
    active = false;
    if (timer) clearTimeout(timer);
  };
}
