import type {
  ConnectorFailure,
  ConnectorOperationContext,
  ConnectorOperationResult,
} from './contracts';

export type ConnectorCircuitState = 'closed' | 'open' | 'half-open';

export interface ConnectorRuntimeState {
  readonly circuitState: ConnectorCircuitState;
  readonly killSwitchEnabled: boolean;
}

export interface ConnectorResiliencePolicy {
  readonly timeoutMs: number;
  readonly maximumAttempts: number;
  readonly initialBackoffMs: number;
  readonly maximumBackoffMs: number;
  readonly jitterRatio?: number;
}

export type ConnectorOperation<T> = (
  signal: AbortSignal,
  attempt: number,
) => Promise<T>;

export interface ConnectorExecutorDependencies {
  readonly clock?: () => number;
  readonly random?: () => number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

export class ConnectorOperationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'ConnectorOperationError';
    this.code = code;
    this.retryable = retryable;
  }
}

function validatePolicy(policy: ConnectorResiliencePolicy): void {
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

function failure(
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

function normalizeFailure(
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

function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new DOMException('Cancelled', 'AbortError'));
    }, { once: true });
  });
}

function createAttemptSignal(
  context: ConnectorOperationContext,
  timeoutMs: number,
  now: number,
): { readonly signal: AbortSignal; readonly cleanup: () => void } {
  const controller = new AbortController();
  const remainingMs = new Date(context.deadlineAt).getTime() - now;
  const effectiveTimeout = Math.max(0, Math.min(timeoutMs, remainingMs));
  const timeout = setTimeout(() => controller.abort('timeout'), effectiveTimeout);
  const cancel = (): void => controller.abort('cancelled');
  context.cancellationSignal?.addEventListener('abort', cancel, { once: true });
  return {
    cleanup: () => {
      clearTimeout(timeout);
      context.cancellationSignal?.removeEventListener('abort', cancel);
    },
    signal: controller.signal,
  };
}

async function executeAttempt<T>(
  operation: ConnectorOperation<T>,
  context: ConnectorOperationContext,
  timeoutMs: number,
  attempt: number,
  now: number,
): Promise<T> {
  const attemptSignal = createAttemptSignal(context, timeoutMs, now);
  const aborted = new Promise<never>((_resolve, reject) => {
    attemptSignal.signal.addEventListener('abort', () => {
      const cancelled = context.cancellationSignal?.aborted === true;
      reject(new ConnectorOperationError(
        cancelled ? 'CONNECTOR_CANCELLED' : 'CONNECTOR_TIMEOUT',
        cancelled ? 'The connector operation was cancelled.' : 'The connector operation timed out.',
        !cancelled,
      ));
    }, { once: true });
  });
  try {
    return await Promise.race([operation(attemptSignal.signal, attempt), aborted]);
  } finally {
    attemptSignal.cleanup();
  }
}

function retryDelay(
  policy: ConnectorResiliencePolicy,
  attempt: number,
  random: () => number,
): number {
  const base = Math.min(
    policy.maximumBackoffMs,
    policy.initialBackoffMs * 2 ** (attempt - 1),
  );
  const spread = base * (policy.jitterRatio ?? 0);
  return Math.max(0, Math.round(base - spread + spread * 2 * random()));
}

export async function executeConnectorOperation<T>(
  operation: ConnectorOperation<T>,
  context: ConnectorOperationContext,
  policy: ConnectorResiliencePolicy,
  runtime: ConnectorRuntimeState,
  dependencies: ConnectorExecutorDependencies = {},
): Promise<ConnectorOperationResult<T>> {
  validatePolicy(policy);
  if (runtime.killSwitchEnabled) {
    return failure(context, 0, 'CONNECTOR_DISABLED', 'This connector is disabled.', false);
  }
  if (runtime.circuitState === 'open') {
    return failure(context, 0, 'CONNECTOR_CIRCUIT_OPEN', 'This connector is temporarily unavailable.', true);
  }

  const clock = dependencies.clock ?? Date.now;
  const wait = dependencies.wait ?? defaultWait;
  const random = dependencies.random ?? Math.random;
  const deadline = new Date(context.deadlineAt).getTime();
  if (!Number.isFinite(deadline)) {
    throw new Error('deadlineAt must be a valid ISO date-time');
  }
  let lastFailure: ConnectorFailure | undefined;

  for (let attempt = 1; attempt <= policy.maximumAttempts; attempt += 1) {
    if (context.cancellationSignal?.aborted === true) {
      return failure(context, attempt - 1, 'CONNECTOR_CANCELLED', 'The connector operation was cancelled.', false);
    }
    if (clock() >= deadline) {
      return failure(context, attempt - 1, 'CONNECTOR_DEADLINE_EXCEEDED', 'The connector operation deadline passed.', false);
    }
    try {
      const value = await executeAttempt(operation, context, policy.timeoutMs, attempt, clock());
      return { attempts: attempt, ok: true, value };
    } catch (error: unknown) {
      lastFailure = normalizeFailure(error, context, attempt);
      if (!lastFailure.retryable || attempt === policy.maximumAttempts) {
        return { error: lastFailure, ok: false };
      }
      const controller = new AbortController();
      const cancel = (): void => controller.abort();
      context.cancellationSignal?.addEventListener('abort', cancel, { once: true });
      try {
        await wait(retryDelay(policy, attempt, random), controller.signal);
      } catch {
        return failure(context, attempt, 'CONNECTOR_CANCELLED', 'The connector operation was cancelled.', false);
      } finally {
        context.cancellationSignal?.removeEventListener('abort', cancel);
      }
    }
  }

  return lastFailure === undefined
    ? failure(context, 0, 'CONNECTOR_NO_ATTEMPT', 'The connector did not run.', false)
    : { error: lastFailure, ok: false };
}
