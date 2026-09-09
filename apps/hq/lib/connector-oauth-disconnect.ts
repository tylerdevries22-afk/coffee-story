import type { SupabaseClient } from '@supabase/supabase-js';

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

/** Remove one tenant/provider authorization through the service-only RPC. */
export async function disconnectConnectorOAuth(
  db: SupabaseClient,
  input: { brandId: string; providerKey: string; actorUserId: string },
): Promise<void> {
  const result = await db.rpc('disconnect_connector_oauth_connection', {
    p_brand_id: input.brandId,
    p_provider_key: input.providerKey,
    p_actor_user_id: input.actorUserId,
  });
  if (result.error || result.data !== true) throw new ConnectorDisconnectError('disconnect_failed');
}
