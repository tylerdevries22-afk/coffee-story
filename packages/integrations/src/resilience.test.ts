import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ConnectorOperationError,
  executeConnectorOperation,
  type ConnectorOperationContext,
  type ConnectorResiliencePolicy,
} from './index';

const context: ConnectorOperationContext = {
  correlationId: 'correlation-1',
  deadlineAt: '2030-01-01T00:00:00.000Z',
  environment: 'staging',
  idempotencyKey: 'idempotency-1', // gitleaks:allow — deterministic test fixture, not a credential.
  installationId: 'installation-1',
  locationId: 'location-1',
  organizationId: 'brand-1',
};

const policy: ConnectorResiliencePolicy = {
  initialBackoffMs: 0,
  maximumAttempts: 2,
  maximumBackoffMs: 0,
  timeoutMs: 100,
};

const runtime = { circuitState: 'closed', killSwitchEnabled: false } as const;

describe('connector resilience executor', () => {
  it('preserves safe structured connector errors', () => {
    const error = new ConnectorOperationError('RATE_LIMITED', 'Try again later.', true);
    assert.deepEqual(
      { code: error.code, message: error.message, name: error.name, retryable: error.retryable },
      { code: 'RATE_LIMITED', message: 'Try again later.', name: 'ConnectorOperationError', retryable: true },
    );
  });

  it('returns a successful operation with its attempt count', async () => {
    const result = await executeConnectorOperation(
      async (signal, attempt) => ({ aborted: signal.aborted, attempt }),
      context,
      policy,
      runtime,
    );
    assert.deepEqual(result, { attempts: 1, ok: true, value: { aborted: false, attempt: 1 } });
  });

  it('retries one transient failure and preserves the idempotent context', async () => {
    const attempts: number[] = [];
    const result = await executeConnectorOperation(
      (_signal, attempt) => {
        attempts.push(attempt);
        return attempt === 1
          ? Promise.reject(new ConnectorOperationError('RATE_LIMITED', 'Try again later.', true))
          : Promise.resolve(context.idempotencyKey);
      },
      context,
      policy,
      runtime,
      { random: () => 0.5, wait: () => Promise.resolve() },
    );
    assert.deepEqual(result, { attempts: 2, ok: true, value: 'idempotency-1' });
    assert.deepEqual(attempts, [1, 2]);
  });

  it('does not retry permanent failures or expose unknown provider details', async () => {
    let permanentCalls = 0;
    const permanent = await executeConnectorOperation(
      () => {
        permanentCalls += 1;
        return Promise.reject(new ConnectorOperationError('SCOPE_MISSING', 'Reconnect this account.', false));
      },
      context,
      policy,
      runtime,
    );
    assert.equal(permanentCalls, 1);
    assert.deepEqual(permanent, {
      error: {
        attempts: 1,
        code: 'SCOPE_MISSING',
        correlationId: 'correlation-1',
        message: 'Reconnect this account.',
        retryable: false,
      },
      ok: false,
    });

    const unknown = await executeConnectorOperation(
      () => Promise.reject(new Error('secret provider response')),
      context,
      policy,
      runtime,
    );
    assert.deepEqual(unknown, {
      error: {
        attempts: 1,
        code: 'CONNECTOR_UNEXPECTED_FAILURE',
        correlationId: 'correlation-1',
        message: 'The connector operation failed unexpectedly.',
        retryable: false,
      },
      ok: false,
    });
  });

  it('times out and retries even when a provider ignores abort', async () => {
    let calls = 0;
    const result = await executeConnectorOperation(
      () => {
        calls += 1;
        return new Promise<string>(() => undefined);
      },
      context,
      { ...policy, timeoutMs: 5 },
      runtime,
      { wait: () => Promise.resolve() },
    );
    assert.equal(calls, 2);
    assert.deepEqual(result, {
      error: {
        attempts: 2,
        code: 'CONNECTOR_TIMEOUT',
        correlationId: 'correlation-1',
        message: 'The connector operation timed out.',
        retryable: true,
      },
      ok: false,
    });
  });

  it('fails before a network call when disabled, circuit-open, cancelled, or expired', async () => {
    let calls = 0;
    const operation = (): Promise<string> => {
      calls += 1;
      return Promise.resolve('unsafe');
    };
    const disabled = await executeConnectorOperation(operation, context, policy, {
      circuitState: 'closed', killSwitchEnabled: true,
    });
    const circuit = await executeConnectorOperation(operation, context, policy, {
      circuitState: 'open', killSwitchEnabled: false,
    });
    const controller = new AbortController();
    controller.abort();
    const cancelled = await executeConnectorOperation(
      operation,
      { ...context, cancellationSignal: controller.signal },
      policy,
      runtime,
    );
    const expired = await executeConnectorOperation(
      operation,
      { ...context, deadlineAt: '2020-01-01T00:00:00.000Z' },
      policy,
      runtime,
    );

    assert.equal(calls, 0);
    assert.equal(disabled.ok ? '' : disabled.error.code, 'CONNECTOR_DISABLED');
    assert.equal(circuit.ok ? '' : circuit.error.code, 'CONNECTOR_CIRCUIT_OPEN');
    assert.equal(cancelled.ok ? '' : cancelled.error.code, 'CONNECTOR_CANCELLED');
    assert.equal(expired.ok ? '' : expired.error.code, 'CONNECTOR_DEADLINE_EXCEEDED');
  });

  it('validates timeout, retry, backoff, jitter, and deadline policies', async () => {
    for (const [override, message] of [
      [{ timeoutMs: 0 }, 'positive integer'],
      [{ maximumAttempts: 1 }, 'at least one retry'],
      [{ initialBackoffMs: -1 }, 'cannot be negative'],
      [{ maximumBackoffMs: -1 }, 'cannot be negative'],
      [{ initialBackoffMs: 2, maximumBackoffMs: 1 }, 'cannot be smaller'],
      [{ jitterRatio: 2 }, 'between zero and one'],
    ] as const) {
      await assert.rejects(
        executeConnectorOperation(
          () => Promise.resolve('ok'),
          context,
          { ...policy, ...override },
          runtime,
        ),
        new RegExp(message),
      );
    }
    await assert.rejects(
      executeConnectorOperation(
        () => Promise.resolve('ok'),
        { ...context, deadlineAt: 'invalid' },
        policy,
        runtime,
      ),
      /valid ISO date-time/u,
    );
  });
});
