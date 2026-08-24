import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { kioskApiConfig } from './api';

describe('kioskApiConfig', () => {
  it('pins a hosted API to the exact configured host', () => {
    assert.deepEqual(
      kioskApiConfig('https://hq.example.com/', 'hq.example.com'),
      { baseUrl: 'https://hq.example.com', allowedHost: 'hq.example.com' },
    );
    assert.equal(kioskApiConfig('https://hq.example.com', 'lookalike.example.com'), null);
  });

  it('allows loopback development without weakening hosted requests', () => {
    assert.deepEqual(
      kioskApiConfig('http://127.0.0.1:3000/', undefined),
      { baseUrl: 'http://127.0.0.1:3000' },
    );
    assert.equal(kioskApiConfig('http://hq.example.com', 'hq.example.com'), null);
    assert.equal(kioskApiConfig('not a url', 'hq.example.com'), null);
  });
});
