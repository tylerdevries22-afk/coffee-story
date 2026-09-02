import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeIceServers } from './cloudflare-turn';

describe('Cloudflare TURN response validation', () => {
  it('accepts bounded STUN and TURN servers', () => {
    const servers = normalizeIceServers([{
      urls: ['stun:stun.cloudflare.com:3478', 'turns:turn.cloudflare.com:5349'],
      username: 'session', credential: 'short-lived-secret',
    }]);
    assert.equal(servers?.[0]?.urls.length, 2);
  });

  it('rejects unsafe protocols and oversized credentials', () => {
    assert.equal(normalizeIceServers([{ urls: ['https://example.com'] }]), null);
    assert.equal(normalizeIceServers([{
      urls: ['turn:turn.cloudflare.com:3478'], credential: 'x'.repeat(1_025),
    }]), null);
  });

  it('removes Cloudflare DNS discovery entries without returning an empty set', () => {
    assert.equal(normalizeIceServers([{ urls: ['stun:stun.cloudflare.com:53'] }]), null);
    assert.deepEqual(normalizeIceServers([{
      urls: ['stun:stun.cloudflare.com:53', 'stun:stun.cloudflare.com:3478'],
    }])?.[0]?.urls, ['stun:stun.cloudflare.com:3478']);
  });
});
