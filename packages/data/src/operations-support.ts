import { OPERATION_STATUSES, type OperationStatus } from '@platform/domain';
import type { OperationOccurrenceRow } from '@platform/schema';

export const OPERATION_COLUMNS = [
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

export type ApiError = { code?: string; message: string };
export type ApiResult = { data: unknown; error: ApiError | null };
export type AbortableResult = PromiseLike<ApiResult> & {
  abortSignal?: (signal: AbortSignal) => PromiseLike<ApiResult>;
};

export function structuredError(error: unknown): OperationDataError {
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function operationRow(value: unknown): OperationOccurrenceRow {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.brand_id !== 'string'
    || typeof value.location_id !== 'string' || typeof value.status !== 'string'
    || !OPERATION_STATUSES.includes(value.status as OperationStatus)) {
    throw new OperationDataError('unknown', 'The operation service returned an invalid response.', false);
  }
  return value as OperationOccurrenceRow;
}

export async function idempotentMutation(
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

export function rpcRequest(query: unknown, signal: AbortSignal): PromiseLike<ApiResult> {
  const abortable = query as AbortableResult;
  return abortable.abortSignal?.(signal) ?? abortable;
}

export function requireIdentifier(value: string, label: string): void {
  if (value.trim().length === 0) throw new OperationDataError('invalid', `${label} is required.`, false);
}
