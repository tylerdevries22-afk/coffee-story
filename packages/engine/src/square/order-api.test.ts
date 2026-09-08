import assert from 'node:assert/strict';
import test from 'node:test';

import { deletePaymentLink, type SquareConfig } from './client';

const config: SquareConfig = {
  env: 'sandbox',
  applicationId: 'application-id',
  applicationSecret: 'application-secret',
  apiBase: 'https://square.example.test',
};

test('deletePaymentLink disables the exact hosted link with merchant auth', async (t) => {
  let request: { url: string; init?: RequestInit } | undefined;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    request = { url: String(input), init };
    return new Response('{}', { status: 200 });
  });

  await deletePaymentLink(config, 'merchant-token', 'link/with space');

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
