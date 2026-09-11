import type { SupabaseClient } from '@supabase/supabase-js';

import type { OperationOccurrenceRow } from '@platform/schema';
import type { OperationCompletionIssue } from './operation-issues';
import { idempotentMutation, operationRow, requireIdentifier, rpcRequest } from './operations-support';

export async function claimOperationOccurrence(
  client: SupabaseClient,
  occurrenceId: string,
  actionId: string,
): Promise<OperationOccurrenceRow> {
  requireIdentifier(occurrenceId, 'Occurrence');
  requireIdentifier(actionId, 'Action');
  const result = await idempotentMutation((signal) => rpcRequest(client.rpc(
    'claim_operation_occurrence', { target_occurrence: occurrenceId, target_action_id: actionId },
  ), signal));
  return operationRow(result);
}

export async function completeOperationOccurrence(
  client: SupabaseClient,
  occurrenceId: string,
  actionId: string,
  responses: Readonly<Record<string, unknown>>,
  note = '',
  issues: readonly OperationCompletionIssue[] = [],
): Promise<OperationOccurrenceRow> {
  requireIdentifier(occurrenceId, 'Occurrence');
  requireIdentifier(actionId, 'Action');
  const result = await idempotentMutation((signal) => rpcRequest(client.rpc(
    'complete_operation_occurrence', {
      target_occurrence: occurrenceId, target_action_id: actionId,
      target_responses: responses, target_note: note, target_issues: issues,
    },
  ), signal));
  return operationRow(result);
}


export async function cancelOperationOccurrence(
  client: SupabaseClient,
  occurrenceId: string,
  actionId: string,
  reason: string,
): Promise<OperationOccurrenceRow> {
  requireIdentifier(occurrenceId, 'Occurrence');
  requireIdentifier(actionId, 'Action');
  const result = await idempotentMutation((signal) => rpcRequest(client.rpc('cancel_operation_occurrence', {
    target_occurrence: occurrenceId, target_action_id: actionId, target_reason: reason,
  }), signal));
  return operationRow(result);
}

export async function releaseOperationOccurrence(
  client: SupabaseClient,
  occurrenceId: string,
  actionId: string,
): Promise<OperationOccurrenceRow> {
  requireIdentifier(occurrenceId, 'Occurrence');
  requireIdentifier(actionId, 'Action');
  const result = await idempotentMutation((signal) => rpcRequest(client.rpc('release_operation_occurrence', {
    target_occurrence: occurrenceId, target_action_id: actionId,
  }), signal));
  return operationRow(result);
}

/** Realtime is only an invalidation boundary; callers reconcile through RLS. */
