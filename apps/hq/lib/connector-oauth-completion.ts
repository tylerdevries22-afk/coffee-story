import type { SupabaseClient } from '@supabase/supabase-js';

import type { OAuthConnectorKey } from './connector-oauth-config';
import type { ConnectorToken } from './connector-oauth-exchange';
import { revokeConnectorToken } from './connector-oauth-revoke';

export class ConnectorCompletionError extends Error {
  constructor(
    readonly cleanupSucceeded: boolean,
    readonly outcome: 'rejected' | 'ambiguous' = 'rejected',
  ) {
    super('The connector authorization could not be stored.');
    this.name = 'ConnectorCompletionError';
  }
}

type CompletionInput = {
  readonly brandId: string;
  readonly installationId: string;
  readonly provider: OAuthConnectorKey;
  readonly actorUserId: string;
  readonly credential: ConnectorToken & Readonly<Record<string, unknown>>;
  readonly accountId: string;
  readonly accountLabel: string;
  readonly grantedScopes: readonly string[];
  readonly expiresAt: string | null;
};

type CompletionResult = { readonly data: unknown; readonly error: unknown };

function accepted(result: CompletionResult): string | null {
  return !result.error && typeof result.data === 'string' && result.data
    ? result.data : null;
}

/** Persist an exchanged token or revoke it before returning a safe failure. */
export async function completeConnectorOAuth(
  db: SupabaseClient,
  input: CompletionInput,
): Promise<string> {
  const completionKey = crypto.randomUUID();
  const args = {
    p_brand_id: input.brandId,
    p_installation_id: input.installationId,
    p_provider_key: input.provider,
    p_actor_user_id: input.actorUserId,
    p_completion_key: completionKey,
    p_credential: input.credential,
    p_account_label: input.accountLabel,
    p_granted_scopes: [...input.grantedScopes],
    p_expires_at: input.expiresAt,
  };
  let completed: CompletionResult;
  try {
    completed = await db.rpc('complete_connector_oauth_connection', args);
  } catch {
    try {
      completed = await db.rpc('complete_connector_oauth_connection', args);
    } catch {
      throw new ConnectorCompletionError(false, 'ambiguous');
    }
  }
  const referenceId = accepted(completed);
  if (referenceId) return referenceId;
  if (!completed.error) {
    throw new ConnectorCompletionError(false, 'ambiguous');
  }
  const cleanupSucceeded = await revokeConnectorToken(
    input.provider, input.credential, input.accountId,
  );
  throw new ConnectorCompletionError(cleanupSucceeded);
}
