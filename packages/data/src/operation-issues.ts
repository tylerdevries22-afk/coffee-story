import type { SupabaseClient } from '@supabase/supabase-js';

import {
  OperationDataError, idempotentMutation, isRecord, requireIdentifier, rpcRequest,
} from './operations-support';

export type OperationCompletionIssue = {
  category: string;
  severity: OperationIssueRow['severity'];
  description: string;
  stepKey: string | null;
};

export type OperationIssueRow = {
  id: string;
  occurrence_id: string;
  category: string;
  severity: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'acknowledged' | 'resolved' | 'dismissed';
  step_key: string | null;
};

function operationIssueRow(value: unknown): OperationIssueRow {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.occurrence_id !== 'string') {
    throw new OperationDataError('unknown', 'The operation service returned an invalid issue.', false);
  }
  return value as OperationIssueRow;
}

export async function reportOperationIssue(
  client: SupabaseClient,
  input: {
    occurrenceId: string; actionId: string; category: string;
    severity: OperationIssueRow['severity']; description: string; stepKey?: string;
  },
): Promise<OperationIssueRow> {
  requireIdentifier(input.occurrenceId, 'Occurrence');
  requireIdentifier(input.actionId, 'Action');
  const result = await idempotentMutation((signal) => rpcRequest(client.rpc('report_operation_issue', {
    target_occurrence: input.occurrenceId, target_action_id: input.actionId,
    target_category: input.category, target_severity: input.severity,
    target_description: input.description, target_step_key: input.stepKey ?? null,
  }), signal));
  return operationIssueRow(result);
}

export async function resolveOperationIssue(
  client: SupabaseClient,
  issueId: string,
  actionId: string,
  resolution: string,
): Promise<OperationIssueRow> {
  requireIdentifier(issueId, 'Issue');
  requireIdentifier(actionId, 'Action');
  const result = await idempotentMutation((signal) => rpcRequest(client.rpc('resolve_operation_issue', {
    target_issue: issueId, target_action_id: actionId, target_resolution: resolution,
  }), signal));
  return operationIssueRow(result);
}
