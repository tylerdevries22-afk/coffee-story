import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import test from 'node:test';

import { fetchExternalWithRetry } from './http';

async function withProvider(run: (url: string) => Promise<void>, respond: (res: ServerResponse) => void) {
  const server = createServer((_request, response) => respond(response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const watchdog = setTimeout(() => server.closeAllConnections(), 1_000);
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    clearTimeout(watchdog);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function partialJson(response: ServerResponse) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.write('{"payment":');
}

test('the deadline includes a stalled body and retries the complete request', async () => {
  let calls = 0;
  await withProvider(async (url) => {
    const response = await fetchExternalWithRetry(url, {}, { timeoutMs: 40, retryDelayMs: 0 });
    assert.deepEqual(await response.json(), { payment: 'complete' });
    assert.equal(calls, 2);
    assert.equal(response.headers.get('x-provider-receipt'), 'second');
  }, (response) => {
    calls += 1;
    if (calls === 1) partialJson(response);
    else {
      response.writeHead(200, { 'Content-Type': 'application/json', 'X-Provider-Receipt': 'second' });
      response.end(JSON.stringify({ payment: 'complete' }));
    }
  });
});

test('a provider that stalls every body fails within the bounded attempts', async () => {
  let calls = 0;
  await withProvider(async (url) => {
    const started = Date.now();
    await assert.rejects(fetchExternalWithRetry(url, {}, { timeoutMs: 40, retryDelayMs: 0 }), /timed out/);
    assert.equal(calls, 2);
    assert.ok(Date.now() - started < 1_000);
  }, (response) => { calls += 1; partialJson(response); });
});

test('parent cancellation during a response body prevents another attempt', async () => {
  let calls = 0;
  const controller = new AbortController();
  await withProvider(async (url) => {
    await assert.rejects(fetchExternalWithRetry(url, { signal: controller.signal }, {
      timeoutMs: 1_000, retryDelayMs: 0,
    }), /cancelled/);
    assert.equal(calls, 1);
  }, (response) => {
    calls += 1;
    partialJson(response);
    setTimeout(() => controller.abort(), 20);
  });
});
