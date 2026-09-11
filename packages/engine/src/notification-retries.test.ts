import assert from 'node:assert/strict';
import test from 'node:test';

import { liveTransport } from './notifications';

const env = { RESEND_API_KEY: 'test-key', RESEND_FROM: 'sender@example.test' };

test('email retries reuse the provider key after acceptance with a lost response', async () => {
  const originalFetch = globalThis.fetch;
  const accepted = new Map<string, string>();
  const requests: { key: string | null; body: string }[] = [];
  let deliveries = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, 'https://api.resend.com/emails');
    const key = new Headers(init?.headers).get('Idempotency-Key');
    const body = String(init?.body);
    requests.push({ key, body });
    if (!key || !accepted.has(key)) {
      deliveries += 1;
      if (key) accepted.set(key, body);
      // The provider accepted the email before its response connection failed.
      if (requests.length === 1) throw new TypeError('connection reset after acceptance');
    } else assert.equal(accepted.get(key), body);
    return Response.json({ id: 'provider-receipt' });
  };
  try {
    const transport = liveTransport(env);
    await transport.sendEmail('guest@example.test', 'Order ready', 'Please collect your order.');
    assert.equal(requests.length, 2);
    assert.equal(deliveries, 1);
    assert.ok(requests[0]!.key);
    assert.equal(requests[0]!.key, requests[1]!.key);
    assert.equal(requests[0]!.body, requests[1]!.body);
    assert.ok(requests[0]!.key!.length <= 256);
    await transport.sendEmail('guest@example.test', 'Order ready', 'Please collect your order.');
    assert.equal(deliveries, 2, 'a distinct send of identical content must remain a distinct message');
    assert.notEqual(requests[2]!.key, requests[0]!.key);
  } finally { globalThis.fetch = originalFetch; }
});

test('email provider failure remains visible after bounded retries', async () => {
  const originalFetch = globalThis.fetch;
  const keys: (string | null)[] = [];
  globalThis.fetch = async (_input, init) => {
    keys.push(new Headers(init?.headers).get('Idempotency-Key'));
    return new Response('busy', { status: 503 });
  };
  try {
    await assert.rejects(liveTransport(env).sendEmail('guest@example.test', 'Ready', 'Ready'), /failed/);
    assert.equal(keys.length, 2);
    assert.ok(keys[0]);
    assert.equal(keys[0], keys[1]);
  } finally { globalThis.fetch = originalFetch; }
});
