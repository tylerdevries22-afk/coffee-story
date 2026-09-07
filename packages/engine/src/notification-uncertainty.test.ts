import assert from 'node:assert/strict';
import test from 'node:test';

import { ExternalRequestError, fetchExternalWithRetry } from './http';
import { NotificationDeliveryUncertainError } from './notification-request';
import { deliverOperationPushBatch, liveTransport, type Transport } from './notifications';

const env = { TWILIO_ACCOUNT_SID: 'test-sid', TWILIO_AUTH_TOKEN: 'test-token', TWILIO_FROM_NUMBER: '+15005550006' };
const senders = {
  push: (transport: Transport) => transport.sendPush('ExponentPushToken[test]', 'Ready', 'Collect your order'),
  sms: (transport: Transport) => transport.sendSms('+15005550009', 'Collect your order'),
};

for (const [channel, send] of Object.entries(senders)) {
  test(`${channel}: acceptance followed by a lost response never creates a second send`, async () => {
    const original = globalThis.fetch;
    let deliveries = 0;
    globalThis.fetch = async () => {
      deliveries += 1;
      throw new TypeError('provider accepted, connection closed before receipt');
    };
    try {
      await assert.rejects(send(liveTransport(env)), NotificationDeliveryUncertainError);
      assert.equal(deliveries, 1);
    } finally { globalThis.fetch = original; }
  });

  test(`${channel}: a rate-limit rejection is retried, with one accepted delivery`, async () => {
    const original = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return requests === 1 ? new Response(null, { status: 429 })
        : Response.json({ data: { status: 'ok', id: 'ticket' }, sid: 'message' });
    };
    try {
      await send(liveTransport(env));
      assert.equal(requests, 2);
    } finally { globalThis.fetch = original; }
  });

  test(`${channel}: a server error has an uncertain outcome and is not posted again`, async () => {
    const original = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => { requests += 1; return new Response(null, { status: 503 }); };
    try {
      await assert.rejects(send(liveTransport(env)), NotificationDeliveryUncertainError);
      assert.equal(requests, 1);
    } finally { globalThis.fetch = original; }
  });
}

test('push: an unreadable success receipt cannot be treated as a definite rejection', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: null });
  try { await assert.rejects(senders.push(liveTransport()), NotificationDeliveryUncertainError); }
  finally { globalThis.fetch = original; }
});

test('a stalled response body is bounded without retrying a non-idempotent send', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    return new Response(new ReadableStream({ start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
    } }));
  };
  try {
    await assert.rejects(fetchExternalWithRetry('https://provider.test/send', { method: 'POST' }, {
      retryMode: 'rejected-only', timeoutMs: 10, retryDelayMs: 0,
    }), (error: unknown) => error instanceof ExternalRequestError && error.code === 'timeout');
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});

test('uncertain operation delivery is distinct from a retryable failure, even in a partial batch', async () => {
  const transport: Transport = {
    sendPush: async (token) => { if (token === 'uncertain') throw new NotificationDeliveryUncertainError(); },
    sendSms: async () => undefined,
    sendEmail: async () => undefined,
  };
  const result = await deliverOperationPushBatch(transport, [{
    outboxId: 'outbox', occurrenceId: 'occurrence', tokens: ['confirmed', 'uncertain'],
    appName: 'Test', taskTitle: 'Safety check', locationName: 'Test location',
  }]);
  assert.deepEqual(result, [{ outboxId: 'outbox', outcome: 'uncertain', errorCode: 'delivery_uncertain' }]);
});
