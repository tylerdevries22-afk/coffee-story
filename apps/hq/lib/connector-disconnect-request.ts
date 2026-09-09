const DISCONNECT_TIMEOUT_MS = 8_000;

export class ConnectorDisconnectRequestError extends Error {
  constructor() {
    super('The connector disconnect request failed.');
    this.name = 'ConnectorDisconnectRequestError';
  }
}

/** The durable disconnect RPC makes one ambiguous browser retry safe. */
export async function requestConnectorDisconnect(
  provider: string,
  fetcher: typeof fetch = globalThis.fetch,
  timeoutMs = DISCONNECT_TIMEOUT_MS,
): Promise<void> {
  const deadline = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(DISCONNECT_TIMEOUT_MS, Math.trunc(timeoutMs)))
    : DISCONNECT_TIMEOUT_MS;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadline);
    try {
      const response = await fetcher(
        `/api/connectors/${encodeURIComponent(provider)}/authorize`,
        { method: 'DELETE', headers: { Accept: 'application/json' }, signal: controller.signal },
      );
      try { await response.body?.cancel(); } catch { /* preserve the response outcome */ }
      if (response.ok) return;
      if (response.status !== 429 && response.status < 500) break;
    } catch { /* retry the idempotent durable mutation once */ }
    finally { clearTimeout(timer); }
  }
  throw new ConnectorDisconnectRequestError();
}
