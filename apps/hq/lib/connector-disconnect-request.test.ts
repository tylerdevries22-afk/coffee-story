import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ConnectorDisconnectRequestError,
  requestConnectorDisconnect,
} from './connector-disconnect-request';

describe('requestConnectorDisconnect', () => {
  it('retries one retryable response and encodes the provider path', async () => {
    const calls: string[] = [];
    await requestConnectorDisconnect('provider/name', async (input) => {
      calls.push(String(input));
      return new Response(null, { status: calls.length === 1 ? 503 : 204 });
    });
    assert.deepEqual(calls, [
      '/api/connectors/provider%2Fname/authorize',
      '/api/connectors/provider%2Fname/authorize',
    ]);
  });

  it('bounds a stalled request and leaves a safe error', async () => {
    let calls = 0;
    await assert.rejects(requestConnectorDisconnect('slack', async (_input, init) => {
      calls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('sensitive request detail')));
      });
    }, 2), (error: unknown) => {
      assert.ok(error instanceof ConnectorDisconnectRequestError);
      assert.ok(!error.message.includes('sensitive request detail'));
      return true;
    });
    assert.equal(calls, 2);
  });
});
