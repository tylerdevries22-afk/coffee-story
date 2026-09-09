import type { SupabaseClient } from '@supabase/supabase-js';

import type { OAuthConnectorKey } from './connector-oauth-config';
import type { ConnectorToken } from './connector-oauth-exchange';
import type { ConnectorIdentityHint } from './connector-oauth-identity-hint';
import { connectorRpc } from './connector-rpc';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type ConnectorCompensationInput = Readonly<{
  brandId: string;
  installationId: string;
  provider: OAuthConnectorKey;
  actorUserId: string;
  operationKey: string;
  credential: ConnectorToken;
  accountLabel: string;
  grantedScopes: readonly string[];
  expiresAt: string | null;
  reason: string;
  identityHint?: ConnectorIdentityHint;
}>;

export type ConnectorCompensationResult = Readonly<{
  outcome: 'connected' | 'cleanup_queued';
  referenceId: string;
}>;

export class ConnectorCompensationError extends Error {
  constructor() {
    super('Connector credential cleanup could not be confirmed.');
    this.name = 'ConnectorCompensationError';
  }
}

function accepted(value: unknown): ConnectorCompensationResult | null {
  if (!value || typeof value !== 'object') return null;
  const outcome = Reflect.get(value, 'outcome');
  const referenceId = Reflect.get(value, 'referenceId');
  return (outcome === 'connected' || outcome === 'cleanup_queued')
    && typeof referenceId === 'string' && UUID.test(referenceId)
    ? { outcome, referenceId } : null;
}

/** Give every issued credential an encrypted, replay-safe lifecycle owner. */
export async function queueConnectorOAuthCompensation(
  db: SupabaseClient,
  input: ConnectorCompensationInput,
): Promise<ConnectorCompensationResult> {
  const args = {
    p_brand_id: input.brandId,
    p_installation_id: input.installationId,
    p_provider_key: input.provider,
    p_actor_user_id: input.actorUserId,
    p_consume_key: input.operationKey,
    p_cleanup_key: input.operationKey,
    p_credential: input.credential,
    p_account_label: input.accountLabel,
    p_granted_scopes: [...input.grantedScopes],
    p_expires_at: input.expiresAt,
    p_reason: input.reason,
    p_identity_hint: input.identityHint ?? {},
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await connectorRpc(db, 'queue_connector_oauth_compensation', args);
      const confirmation = !result.error ? accepted(result.data) : null;
      if (confirmation) return confirmation;
    } catch { /* retry the stable intake key after an ambiguous response */ }
  }
  throw new ConnectorCompensationError();
}
