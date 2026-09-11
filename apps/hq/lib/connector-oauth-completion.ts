import type { SupabaseClient } from '@supabase/supabase-js';

import type { OAuthConnectorKey } from './connector-oauth-config';
import type { ConnectorToken } from './connector-oauth-exchange';
import type { ConnectorIdentityHint } from './connector-oauth-identity-hint';
import {
  ConnectorCompensationError,
  queueConnectorOAuthCompensation,
} from './connector-oauth-compensation';
import { connectorRpc } from './connector-rpc';

export class ConnectorCompletionError extends Error {
  constructor(
    readonly cleanup: 'not_required' | 'queued' | 'ambiguous',
    readonly outcome: 'rejected' | 'ambiguous' = 'rejected',
    readonly contractCode: CompletionContractCode | null = null,
    readonly compensationReason = outcome === 'ambiguous'
      ? 'completion_ambiguous' : 'completion_rejected',
  ) {
    super('The connector authorization could not be stored.');
    this.name = 'ConnectorCompletionError';
  }
}

export type CompletionInput = {
  readonly brandId: string;
  readonly installationId: string;
  readonly provider: OAuthConnectorKey;
  readonly actorUserId: string;
  readonly completionKey: string;
  readonly credential: ConnectorToken & Readonly<Record<string, unknown>>;
  readonly accountId: string;
  readonly accountLabel: string;
  readonly grantedScopes: readonly string[];
  readonly expiresAt: string | null;
  readonly identityHint?: ConnectorIdentityHint;
};

type CompletionResult = { readonly data: unknown; readonly error: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTRACT_CODES = [
  'connector_oauth_completion_conflict_safe_revoke',
  'connector_oauth_completion_conflict_shared_grant',
  'connector_oauth_completion_conflict',
  'connector_oauth_credential_operation_in_progress',
  'connector_oauth_existing_grant_unidentified',
  'connector_oauth_existing_credential_invalid',
  'connector_oauth_contract_changed',
  'connector_oauth_capability_unavailable',
  'connector_oauth_state_incomplete',
  'connector_oauth_scope_grant_incomplete',
  'connector_oauth_refresh_contract_invalid',
  'connector_oauth_forbidden',
  'connector_provider_unavailable',
  'connector_installation_unknown',
] as const;
type CompletionContractCode = (typeof CONTRACT_CODES)[number];

function accepted(result: CompletionResult): string | null {
  return !result.error && typeof result.data === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(result.data)
    ? result.data : null;
}

function completionContractCode(error: unknown): CompletionContractCode | null {
  if (!error || typeof error !== 'object') return null;
  const message = Reflect.get(error, 'message');
  return typeof message === 'string'
    && (CONTRACT_CODES as readonly string[]).includes(message)
    ? message as CompletionContractCode : null;
}

async function compensate(
  db: SupabaseClient,
  input: CompletionInput,
  reason: string,
): Promise<string | null> {
  const result = await queueConnectorOAuthCompensation(db, {
    ...input, operationKey: input.completionKey, reason,
  });
  return result.outcome === 'connected' ? result.referenceId : null;
}

async function handOffCredential(
  db: SupabaseClient,
  input: CompletionInput,
  reason: string,
  outcome: ConnectorCompletionError['outcome'],
  contractCode: CompletionContractCode | null = null,
): Promise<string> {
  try {
    const connected = await compensate(db, input, reason);
    if (connected) return connected;
    throw new ConnectorCompletionError('queued', outcome, contractCode, reason);
  } catch (error) {
    if (error instanceof ConnectorCompletionError) throw error;
    if (!(error instanceof ConnectorCompensationError)) throw error;
    throw new ConnectorCompletionError('ambiguous', outcome, contractCode, reason);
  }
}

/** Persist an exchanged token or revoke it before returning a safe failure. */
export async function completeConnectorOAuth(
  db: SupabaseClient,
  input: CompletionInput,
): Promise<string> {
  if (!UUID.test(input.completionKey)) {
    throw new ConnectorCompletionError('not_required', 'rejected', 'connector_oauth_state_incomplete');
  }
  const args = {
    p_brand_id: input.brandId,
    p_installation_id: input.installationId,
    p_provider_key: input.provider,
    p_actor_user_id: input.actorUserId,
    p_completion_key: input.completionKey,
    p_credential: input.credential,
    p_account_label: input.accountLabel,
    p_granted_scopes: [...input.grantedScopes],
    p_expires_at: input.expiresAt,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let completed: CompletionResult;
    try {
      completed = await connectorRpc(db, 'complete_connector_oauth_connection', args);
    } catch {
      if (attempt === 0) continue;
      return handOffCredential(db, input, 'completion_ambiguous', 'ambiguous');
    }
    const referenceId = accepted(completed);
    if (referenceId) return referenceId;
    if (!completed.error && completed.data === null) {
      throw new ConnectorCompletionError('queued', 'rejected', null, 'completion_rejected_owned');
    }
    const contractCode = completionContractCode(completed.error);
    if (!contractCode) {
      if (attempt === 0) continue;
      return handOffCredential(db, input, 'completion_ambiguous', 'ambiguous');
    }
    const reason = contractCode.replace(/^connector_oauth_/u, '');
    return handOffCredential(db, input, reason, 'rejected', contractCode);
  }
  throw new ConnectorCompletionError('ambiguous', 'ambiguous');
}
