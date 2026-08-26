import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { AppNetworkError, fetchWithRetry } from './http';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchWithRetry', () => {
  it('aborts and retries a hung safe read before returning a structured timeout', async () => {
    let calls = 0;
    globalThis.fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
      calls += 1;
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      }, { once: true });
    });

    await assert.rejects(
      fetchWithRetry('https://example.test/tickets', {}, 5, 2),
      (error: unknown) => error instanceof AppNetworkError && error.code === 'timeout',
    );
    assert.equal(calls, 2);
  });
});
