import type { SupabaseClient } from '@supabase/supabase-js';

import { connectorRpc } from './connector-rpc';

export class ConnectorDisconnectError extends Error {
  constructor(readonly code: 'disconnect_failed') {
    super('The connector could not be disconnected.');
    this.name = 'ConnectorDisconnectError';
  }
}

export async function sameOriginConnectorMutation(
  request: Request,
  run: () => Promise<Response>,
): Promise<Response> {
  const origin = request.headers.get('origin');
  try {
    if (!origin || new URL(origin).origin !== new URL(request.url).origin) {
      return new Response('Cross-origin connector changes are forbidden.', { status: 403 });
    }
  } catch {
    return new Response('Cross-origin connector changes are forbidden.', { status: 403 });
  }
  return run();
}

/** Disable locally and enqueue durable upstream revocation through the service RPC. */
export async function disconnectConnectorOAuth(
  db: SupabaseClient,
  input: { brandId: string; providerKey: string; actorUserId: string },
): Promise<void> {
  const args = {
    p_brand_id: input.brandId,
    p_provider_key: input.providerKey,
    p_actor_user_id: input.actorUserId,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await connectorRpc(db, 'disconnect_connector_oauth_connection', args);
      if (!result.error && result.data === true) return;
    } catch { /* the idempotent RPC can safely reconcile an ambiguous attempt */ }
  }
  throw new ConnectorDisconnectError('disconnect_failed');
}
