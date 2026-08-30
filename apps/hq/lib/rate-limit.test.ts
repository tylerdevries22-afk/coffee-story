import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clientIdentity, rateLimited, resetRateLimits } from './rate-limit';

describe('shared rate limiter', () => {
  it('spends a budget per identity and route, and refills on the next window', () => {
    resetRateLimits();
    assert.equal(rateLimited('a', '/pair', 1_000, 2), false);
    assert.equal(rateLimited('a', '/pair', 1_001, 2), false);
    assert.equal(rateLimited('a', '/pair', 1_002, 2), true);
    // A different route, and a different caller, each carry their own count.
    assert.equal(rateLimited('a', '/exchange', 1_002, 2), false);
    assert.equal(rateLimited('b', '/pair', 1_002, 2), false);
    assert.equal(rateLimited('a', '/pair', 61_001, 2), false);
  });

  it('keeps counting a caller who keeps knocking inside one window', () => {
    resetRateLimits();
    for (let attempt = 0; attempt < 10; attempt += 1) rateLimited('flood', '/pair', 1_000, 10);
    // The eleventh is over budget and every later one stays over: a limiter
    // that reset on the first refusal would hand out a fresh ten immediately.
    assert.equal(rateLimited('flood', '/pair', 1_500, 10), true);
    assert.equal(rateLimited('flood', '/pair', 2_000, 10), true);
  });

  it('reads the peer the platform reports, preferring what a client cannot prepend to', () => {
    const withReal = new Request('https://example.test/', {
      headers: { 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1, 203.0.113.7' },
    });
    assert.equal(clientIdentity(withReal), '203.0.113.7');

    const forwardedOnly = new Request('https://example.test/', {
      headers: { 'x-forwarded-for': ' 198.51.100.4 , 10.0.0.1 ' },
    });
    assert.equal(clientIdentity(forwardedOnly), '198.51.100.4');
  });

  it('buckets an unidentifiable caller rather than letting it past', () => {
    resetRateLimits();
    const anonymous = clientIdentity(new Request('https://example.test/'));
    assert.equal(anonymous, 'unknown');
    assert.equal(rateLimited(anonymous, '/pair', 1_000, 1), false);
    assert.equal(rateLimited(anonymous, '/pair', 1_001, 1), true);
  });
});
