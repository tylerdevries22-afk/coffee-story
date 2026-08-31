import assert from 'node:assert/strict';
import test from 'node:test';

import { revokeOAuthToken, type SquareConfig } from './client';

test('revokeOAuthToken authenticates with the Square application secret', async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = (async (_input, init) => {
    request = init;
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;

  const config: SquareConfig = {
    env: 'sandbox',
    applicationId: 'application-id',
    applicationSecret: 'application-secret',
    apiBase: 'https://square.example.test',
  };
  try {
    await revokeOAuthToken(config, 'merchant-access-token');
    assert.equal(new Headers(request?.headers).get('authorization'), 'Client application-secret');
    assert.deepEqual(JSON.parse(String(request?.body)), {
      client_id: 'application-id',
      access_token: 'merchant-access-token',
      revoke_only_access_token: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
