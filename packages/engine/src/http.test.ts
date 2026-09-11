import assert from 'node:assert/strict';
import test from 'node:test';

import { ExternalRequestError, fetchExternalWithRetry } from './http';

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

test('terminal provider failures retain a safe message and status', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('provider secret detail', { status: 503 });
  try {
    await assert.rejects(fetchExternalWithRetry('https://provider.example.test', {}, { retryDelayMs: 0 }),
      (error: unknown) => {
        assert.ok(error instanceof ExternalRequestError);
        assert.equal(error.code, 'provider');
        assert.equal(error.status, 503);
        assert.equal(error.message, 'External provider request failed.');
        return true;
      });
  } finally { globalThis.fetch = originalFetch; }
});

test('transport failures retain their cause without exposing it in the message', async () => {
  const originalFetch = globalThis.fetch;
  const cause = new TypeError('connection refused');
  globalThis.fetch = async () => { throw cause; };
  try {
    await assert.rejects(fetchExternalWithRetry('https://provider.example.test', {}, { retryDelayMs: 0 }),
      (error: unknown) => {
        assert.ok(error instanceof ExternalRequestError);
        assert.equal(error.code, 'network');
        assert.equal(error.cause, cause);
        assert.equal(error.message, 'External provider request failed.');
        return true;
      });
  } finally { globalThis.fetch = originalFetch; }
});

test('empty successes and client errors preserve response semantics without retrying', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [204, 400]) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return new Response(status === 204 ? null : '{"error":"invalid"}', { status });
      };
      const response = await fetchExternalWithRetry('https://provider.example.test');
      assert.equal(response.status, status);
      assert.equal(await response.text(), status === 204 ? '' : '{"error":"invalid"}');
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test('a pre-cancelled request makes no provider call', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('ok'); };
  try {
    await assert.rejects(fetchExternalWithRetry('https://provider.example.test', {
      signal: AbortSignal.abort(),
    }), /cancelled/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
