/** Shared shapes for the connector resilience executor. */
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
