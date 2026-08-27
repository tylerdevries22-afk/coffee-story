import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchExternalWithRetry } from './http';

test('fetchExternalWithRetry retries transient provider responses', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? new Response('busy', { status: 503 }) : new Response('ok', { status: 200 });
  };
  try {
    const response = await fetchExternalWithRetry('https://provider.example.test', {}, { retryDelayMs: 0 });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchExternalWithRetry aborts a hung provider call', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'AbortError')), { once: true });
  });
  try {
    await assert.rejects(
      fetchExternalWithRetry('https://provider.example.test', {}, { timeoutMs: 5, retryDelayMs: 0 }),
      /timed out/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
