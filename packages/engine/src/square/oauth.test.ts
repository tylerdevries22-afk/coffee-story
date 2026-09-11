import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';

import { ExternalRequestError } from '../http';
import { exchangeOAuthCode, oauthAuthorizeUrl } from './oauth';

afterEach(() => mock.restoreAll());

const CONFIG = {
  applicationId: 'app-id',
  applicationSecret: 'secret',
  env: 'sandbox' as const,
};

test('Square consent requests every permission used by checkout and payment fees', () => {
  const url = new URL(oauthAuthorizeUrl(CONFIG, 'csrf-state'));
  const scopes = url.searchParams.get('scope')?.split(' ');
  assert.deepEqual(scopes, [
    'MERCHANT_PROFILE_READ', 'ORDERS_WRITE', 'ORDERS_READ', 'PAYMENTS_WRITE',
    'PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS', 'PAYMENTS_READ',
  ]);
  assert.equal(url.searchParams.get('state'), 'csrf-state');
});

test('Square code exchange does not replay after a transient rejection', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () =>
    new Response('{"errors":[{"code":"SERVICE_UNAVAILABLE"}]}', { status: 503 }));
  await assert.rejects(
    exchangeOAuthCode(CONFIG, 'one-time-code'),
    (error: unknown) => error instanceof ExternalRequestError
      && error.code === 'provider'
      && error.status === 503,
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('Square code exchange does not replay after an ambiguous network failure', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('connection reset after request write');
  });
  await assert.rejects(
    exchangeOAuthCode(CONFIG, 'one-time-code'),
    (error: unknown) => error instanceof ExternalRequestError && error.code === 'network',
  );
  assert.equal(fetchMock.mock.callCount(), 1);
});
