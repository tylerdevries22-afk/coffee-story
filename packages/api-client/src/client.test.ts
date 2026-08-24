import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createApiClient, resolveApiUrl } from './client';
import { newIdempotencyKey } from './idempotency';
import { requestCanRetry } from './http';

const config = { baseUrl: 'https://api.example.com', allowedHost: 'api.example.com' };

describe('resolveApiUrl', () => {
  it('resolves a normal path against the allowlisted base', () => {
    assert.equal(resolveApiUrl('/api/orders', config), 'https://api.example.com/api/orders');
  });

  it('rejects protocol-relative and backslash escapes', () => {
    assert.throws(() => resolveApiUrl('//evil.com/x', config), /invalid/);
    assert.throws(() => resolveApiUrl('/\\evil.com/x', config), /invalid/);
    assert.throws(() => resolveApiUrl('api/orders', config), /invalid/);
  });

  it('fails closed on a host mismatch and on plain http', () => {
    assert.throws(
      () => resolveApiUrl('/api/orders', { baseUrl: 'https://other.example.com', allowedHost: 'api.example.com' }),
      /not allowlisted/,
    );
    assert.throws(
      () => resolveApiUrl('/api/orders', { baseUrl: 'http://api.example.com', allowedHost: 'api.example.com' }),
      /HTTPS/,
    );
  });

  it('allows localhost only in development mode', () => {
    assert.equal(
      resolveApiUrl('/api/health', { baseUrl: 'http://localhost:3000', developmentMode: true }),
      'http://localhost:3000/api/health',
    );
    assert.throws(() => resolveApiUrl('/api/health', { baseUrl: 'http://localhost:3000' }), /HTTPS/);
  });
});

describe('idempotency keys', () => {
  it('are unique and uuid-shaped', () => {
    const keys = new Set(Array.from({ length: 100 }, () => newIdempotencyKey()));
    assert.equal(keys.size, 100);
    for (const key of keys) {
      assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});

describe('requestCanRetry', () => {
  it('retries safe methods and keyed writes only', () => {
    assert.equal(requestCanRetry({ method: 'GET' }), true);
    assert.equal(requestCanRetry({ method: 'DELETE' }), true);
    assert.equal(requestCanRetry({ method: 'POST' }), false);
    assert.equal(requestCanRetry({ method: 'POST', headers: { 'Idempotency-Key': 'k' } }), true);
  });
});

describe('deleteProfile', () => {
  it('uses the authenticated DELETE endpoint', async () => {
    const originalFetch = globalThis.fetch;
    let observed: { method?: string; authorization?: string } = {};
    globalThis.fetch = async (_input, init) => {
      observed = {
        method: init?.method,
        authorization: new Headers(init?.headers).get('authorization') ?? undefined,
      };
      return Response.json({ ok: true });
    };
    try {
      const client = createApiClient({ ...config, getAccessToken: async () => 'guest-token' });
      await client.deleteProfile();
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.deepEqual(observed, { method: 'DELETE', authorization: 'Bearer guest-token' });
  });
});
