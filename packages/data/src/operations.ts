import type { SupabaseClient } from '@supabase/supabase-js';

<<<<<<< ours
<<<<<<< ours
import { OPERATION_STATUSES, type OperationStatus } from '@platform/domain';
import type { OperationOccurrenceRow } from '@platform/schema';
import { abortRead, readWithRetry } from './read-retry';

const OPERATION_COLUMNS = [
  'id', 'brand_id', 'location_id', 'schedule_id', 'template_id', 'source',
  'materialization_key', 'template_snapshot', 'scheduled_for', 'due_at',
  'grace_minutes', 'status', 'claimed_by', 'claimed_at', 'claim_expires_at',
  'completed_at', 'completion_note', 'created_at', 'updated_at',
].join(',');
const MUTATION_TIMEOUT_MS = 10_000;
const MUTATION_ATTEMPTS = 2;

export type OperationDataErrorCode =
  | 'conflict' | 'forbidden' | 'ineligible' | 'invalid' | 'network' | 'not_found' | 'unknown';

export class OperationDataError extends Error {
  constructor(
    readonly code: OperationDataErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OperationDataError';
  }
}

type ApiError = { code?: string; message: string };
type ApiResult = { data: unknown; error: ApiError | null };
type AbortableResult = PromiseLike<ApiResult> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<ApiResult>;
};

function structuredError(error: unknown): OperationDataError {
  if (error instanceof OperationDataError) return error;
  if (error instanceof Error && (error.name === 'AbortError' || error instanceof TypeError)) {
    return new OperationDataError('network', 'The operation service is temporarily unavailable.', true);
  }
  const apiError = error as Partial<ApiError>;
  const detail = typeof apiError.message === 'string' ? apiError.message : '';
  const code = typeof apiError.code === 'string' ? apiError.code : '';
  if (detail.includes('not_accessible') || detail.includes('manager_required')) {
    return new OperationDataError('forbidden', 'You no longer have access to this operation.', false);
  }
  if (detail.includes('eligibility_required')) {
    return new OperationDataError('ineligible', 'Required training or role eligibility is missing.', false);
  }
  if (detail.includes('not_claimable') || detail.includes('not_owned') || detail.includes('action_id_conflict')) {
    return new OperationDataError('conflict', 'This operation changed. Refresh it and try again.', false);
  }
  if (code === '22023' || detail.includes('_invalid') || detail.includes('_required')) {
    return new OperationDataError('invalid', 'Review the operation details and try again.', false);
  }
  const retryable = code.startsWith('08') || ['40001', '40P01', '57014', 'PGRST000', 'PGRST001'].includes(code);
  return new OperationDataError(retryable ? 'network' : 'unknown',
    retryable ? 'The operation service is temporarily unavailable.' : 'The operation could not be saved.', retryable);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function operationRow(value: unknown): OperationOccurrenceRow {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.brand_id !== 'string'
    || typeof value.location_id !== 'string' || typeof value.status !== 'string'
    || !OPERATION_STATUSES.includes(value.status as OperationStatus)) {
    throw new OperationDataError('unknown', 'The operation service returned an invalid response.', false);
  }
  return value as OperationOccurrenceRow;
}

async function idempotentMutation(
  request: (signal: AbortSignal) => PromiseLike<ApiResult>,
): Promise<unknown> {
  let lastError = new OperationDataError('network', 'The operation service is temporarily unavailable.', true);
  for (let attempt = 0; attempt < MUTATION_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MUTATION_TIMEOUT_MS);
    try {
      const result = await request(controller.signal);
      if (!result.error) return result.data;
      lastError = structuredError(result.error);
      if (!lastError.retryable) throw lastError;
    } catch (error) {
      lastError = structuredError(error);
      if (!lastError.retryable) throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function rpcRequest(query: unknown, signal: AbortSignal): PromiseLike<ApiResult> {
  const abortable = query as AbortableResult;
  return abortable.abortSignal?.(signal) ?? abortable;
}

function requireIdentifier(value: string, label: string): void {
  if (value.trim().length === 0) throw new OperationDataError('invalid', `${label} is required.`, false);
}

=======
import type { OperationOccurrenceRow } from '@platform/schema';
import { abortRead, readWithRetry } from './read-retry';

>>>>>>> theirs
=======
import type { OperationOccurrenceRow } from '@platform/schema';
import { abortRead, readWithRetry } from './read-retry';

>>>>>>> theirs
export async function fetchOperationQueue(
  client: SupabaseClient,
  brandId: string,
  locationId: string,
  startsBefore: string,
): Promise<OperationOccurrenceRow[]> {
<<<<<<< ours
<<<<<<< ours
  requireIdentifier(brandId, 'Brand');
  requireIdentifier(locationId, 'Location');
  try {
    const rows = await readWithRetry('fetchOperationQueue', (signal) => abortRead(client
      .from('operation_occurrences')
      .select(OPERATION_COLUMNS)
      .eq('brand_id', brandId)
      .eq('location_id', locationId)
      .lte('scheduled_for', startsBefore)
      .in('status', ['scheduled', 'claimed'])
      .order('scheduled_for'), signal).returns<OperationOccurrenceRow[]>());
    return (rows ?? []).map(operationRow);
  } catch (error) {
    throw structuredError(error);
  }
=======
=======
>>>>>>> theirs
  const rows = await readWithRetry('fetchOperationQueue', (signal) => abortRead(client
    .from('operation_occurrences')
    .select('*')
    .eq('brand_id', brandId)
    .eq('location_id', locationId)
    .lte('scheduled_for', startsBefore)
    .in('status', ['upcoming', 'due', 'claimed', 'overdue'])
    .order('scheduled_for'), signal).returns<OperationOccurrenceRow[]>());
  return rows ?? [];
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
}

export async function claimOperationOccurrence(
  client: SupabaseClient,
  occurrenceId: string,
<<<<<<< ours
<<<<<<< ours
  actionId: string,
): Promise<OperationOccurrenceRow> {
  requireIdentifier(occurrenceId, 'Occurrence');
  requireIdentifier(actionId, 'Action');
  const result = await idempotentMutation((signal) => rpcRequest(client.rpc(
    'claim_operation_occurrence', { target_occurrence: occurrenceId, target_action_id: actionId },
  ), signal));
  return operationRow(result);
=======
=======
>>>>>>> theirs
): Promise<OperationOccurrenceRow> {
  const { data, error } = await client.rpc('claim_operation_occurrence', {
    target_occurrence: occurrenceId,
  });
  if (error) throw error;
  if (!data) throw new Error('The operation occurrence could not be claimed.');
  return data as OperationOccurrenceRow;
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
}

export async function completeOperationOccurrence(
  client: SupabaseClient,
  occurrenceId: string,
<<<<<<< ours
<<<<<<< ours
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
=======
=======
>>>>>>> theirs
  responses: Readonly<Record<string, unknown>>,
  note = '',
): Promise<OperationOccurrenceRow> {
  const { data, error } = await client.rpc('complete_operation_occurrence', {
    target_occurrence: occurrenceId,
    target_responses: responses,
    target_note: note,
  });
  if (error) throw error;
  if (!data) throw new Error('The operation occurrence could not be completed.');
  return data as OperationOccurrenceRow;
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
}

/** Realtime is only an invalidation boundary; callers reconcile through RLS. */
export function subscribeToOperationQueue(
  client: SupabaseClient,
  locationId: string,
  onChange: () => void,
<<<<<<< ours
<<<<<<< ours
  onError?: (error: OperationDataError) => void,
): () => void {
  requireIdentifier(locationId, 'Location');
  const channel = client.channel(`operations-${locationId}`).on('postgres_changes', {
    event: '*', schema: 'public', table: 'operations_change_signals', filter: `location_id=eq.${locationId}`,
  }, () => onChange()).subscribe((status) => {
    if (status === 'SUBSCRIBED') onChange();
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      onError?.(new OperationDataError('network', 'Live operations updates are reconnecting.', true));
    }
  });
=======
=======
>>>>>>> theirs
): () => void {
  const channel = client.channel(`operations-${locationId}`).on('postgres_changes', {
    event: '*', schema: 'public', table: 'operations_change_signals', filter: `location_id=eq.${locationId}`,
  }, onChange).subscribe();
<<<<<<< ours
>>>>>>> theirs
=======
>>>>>>> theirs
  return () => { void client.removeChannel(channel); };
}
