import assert from 'node:assert/strict';
import test from 'node:test';

import { deletePaymentLink, retrieveSquareOrder, type SquareConfig } from './client';

const config: SquareConfig = {
  env: 'sandbox',
  applicationId: 'application-id',
  applicationSecret: 'application-secret',
  apiBase: 'https://square.example.test',
};

test('deletePaymentLink disables the exact hosted link with merchant auth', async (t) => {
  let request: { url: string; init?: RequestInit } | undefined;
  t.mock.method(globalThis, 'fetch', async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ id: 'link/with space', cancelled_order_id: 'order-1' }),
      { status: 200 });
  });

  const deleted = await deletePaymentLink(config, 'merchant-token', 'link/with space');

  assert.equal(deleted.cancelled_order_id, 'order-1');
  assert.equal(request?.url,
    'https://square.example.test/v2/online-checkout/payment-links/link%2Fwith%20space');
  assert.equal(request?.init?.method, 'DELETE');
  assert.equal(new Headers(request?.init?.headers).get('authorization'), 'Bearer merchant-token');
});

test('deletePaymentLink rejects an empty provider id before making a request', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch');
  await assert.rejects(deletePaymentLink(config, 'merchant-token', '  '), /id is required/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('retrieveSquareOrder reads the exact provider order for cancellation recovery', async (t) => {
  let request: { url: string; init?: RequestInit } | undefined;
  t.mock.method(globalThis, 'fetch', async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ order: { id: 'order/with space', state: 'CANCELED' } }));
  });

  const result = await retrieveSquareOrder(config, 'merchant-token', 'order/with space');

  assert.equal(result.order?.state, 'CANCELED');
  assert.equal(request?.url, 'https://square.example.test/v2/orders/order%2Fwith%20space');
  assert.equal(request?.init?.method, 'GET');
});
