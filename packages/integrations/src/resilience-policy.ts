import type {
  ConnectorFailure,
  ConnectorOperationContext,
  ConnectorOperationResult,
} from './contracts';
import {
  ConnectorOperationError,
  type ConnectorResiliencePolicy,
} from './resilience-types';

export function validatePolicy(policy: ConnectorResiliencePolicy): void {
  if (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive integer');
  }
  if (!Number.isInteger(policy.maximumAttempts) || policy.maximumAttempts < 2) {
    throw new Error('maximumAttempts must include at least one retry');
  }
  if (policy.initialBackoffMs < 0 || policy.maximumBackoffMs < 0) {
    throw new Error('Backoff values cannot be negative');
  }
  if (policy.maximumBackoffMs < policy.initialBackoffMs) {
    throw new Error('maximumBackoffMs cannot be smaller than initialBackoffMs');
  }
  const jitter = policy.jitterRatio ?? 0;
  if (jitter < 0 || jitter > 1) {
    throw new Error('jitterRatio must be between zero and one');
  }
}

export function failure(
  context: ConnectorOperationContext,
  attempts: number,
  code: string,
  message: string,
  retryable: boolean,
): ConnectorOperationResult<never> {
  return {
    error: { attempts, code, correlationId: context.correlationId, message, retryable },
    ok: false,
  };
}

export function normalizeFailure(
  error: unknown,
  context: ConnectorOperationContext,
  attempts: number,
): ConnectorFailure {
  if (error instanceof ConnectorOperationError) {
    return {
      attempts,
      code: error.code,
      correlationId: context.correlationId,
      message: error.message,
      retryable: error.retryable,
    };
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return {
      attempts,
      code: 'CONNECTOR_TIMEOUT',
      correlationId: context.correlationId,
      message: 'The connector operation timed out.',
      retryable: true,
    };
  }
  return {
    attempts,
    code: 'CONNECTOR_UNEXPECTED_FAILURE',
    correlationId: context.correlationId,
    message: 'The connector operation failed unexpectedly.',
    retryable: false,
  };
}
