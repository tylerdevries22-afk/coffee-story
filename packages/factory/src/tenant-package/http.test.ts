import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { discardResponse, readBoundedJson, requestWithRetry } from './http';

const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

describe('tenant package HTTP response ownership', () => {
  it('decodes a JSON response only within its byte bound', async () => {
    assert.deepEqual(await readBoundedJson(Response.json({ ok: true }), 32), { ok: true });
    await assert.rejects(readBoundedJson(new Response('{'), 32), {
      code: 'remote_response_invalid',
    });
    await assert.rejects(readBoundedJson(new Response(Uint8Array.of(0xff)), 32), {
      code: 'remote_response_invalid',
    });
    await assert.rejects(readBoundedJson(new Response(new ReadableStream({
      pull() { throw new Error('raw transport failure'); },
    })), 32), { code: 'remote_response_invalid' });
  });

  it('cancels an oversized response stream and reports a typed error', async () => {
    let cancellations = 0;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(33)); },
      cancel() { cancellations += 1; },
    }));
    await assert.rejects(readBoundedJson(response, 32), { code: 'remote_response_invalid' });
    assert.equal(cancellations, 1);
  });

  it('cancels rejected and explicitly discarded response bodies', async () => {
    let cancellations = 0;
    const pendingBody = () => new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Uint8Array.of(1)); },
      cancel() { cancellations += 1; },
    });
    globalThis.fetch = async () => new Response(pendingBody(), { status: 400 });
    await assert.rejects(
      requestWithRetry('https://example.test', {}, [200]),
      { code: 'remote_request_failed' },
    );
    await discardResponse(new Response(pendingBody(), { status: 200 }));
    assert.equal(cancellations, 2);
  });
});
