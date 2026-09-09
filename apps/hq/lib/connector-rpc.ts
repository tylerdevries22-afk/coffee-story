import type { SupabaseClient } from '@supabase/supabase-js';

export type ConnectorRpcResult = { readonly data: unknown; readonly error: unknown };

export class ConnectorRpcTransportError extends Error {
  constructor() {
    super('The connector storage request did not complete.');
    this.name = 'ConnectorRpcTransportError';
  }
}

type AbortableRequest = {
  readonly abortSignal?: (signal: AbortSignal) => PromiseLike<unknown>;
};

/** Run one PostgREST RPC attempt with a hard local deadline and no raw error logging. */
export async function connectorRpc(
  db: SupabaseClient,
  name: string,
  args: Readonly<Record<string, unknown>>,
  timeoutMs = 8_000,
): Promise<ConnectorRpcResult> {
  const deadline = Number.isFinite(timeoutMs)
    ? Math.max(1, Math.min(10_000, Math.trunc(timeoutMs))) : 8_000;
  const controller = new AbortController();
  let rejectTimeout: ((reason: Error) => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => {
    controller.abort();
    rejectTimeout?.(new ConnectorRpcTransportError());
  }, deadline);
  try {
    const client = db as unknown as {
      rpc: (rpcName: string, rpcArgs: Readonly<Record<string, unknown>>) => unknown;
    };
    const request = client.rpc(name, args) as AbortableRequest | PromiseLike<unknown>;
    const operation = typeof (request as AbortableRequest)?.abortSignal === 'function'
      ? (request as AbortableRequest).abortSignal?.(controller.signal) : request;
    const result = await Promise.race([Promise.resolve(operation), timeout]);
    if (!result || typeof result !== 'object') throw new ConnectorRpcTransportError();
    return { data: Reflect.get(result, 'data'), error: Reflect.get(result, 'error') };
  } catch (error) {
    if (error instanceof ConnectorRpcTransportError) throw error;
    throw new ConnectorRpcTransportError();
  } finally {
    clearTimeout(timer);
  }
}
