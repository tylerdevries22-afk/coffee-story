import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { revalidateStorefrontCapabilities } from './capability-revalidation';

const NOW = () => new Date('2026-09-03T18:45:00.000Z');

function recordingCache() {
  const written: string[] = [];
  return { written, write: async (snapshot: string) => { written.push(snapshot); } };
}

describe('revalidateStorefrontCapabilities', () => {
  it('leaves the bundle standing when the server cannot answer', async () => {
    // The whole point of the design: an offline cold boot must not resolve to
    // an empty capability set, because a feature-less app is a worse failure
    // than a stale one and the flags authorize no write on their own.
    const cache = recordingCache();
    const result = await revalidateStorefrontCapabilities({
      slug: 'coffee-story',
      bundled: ['growth-drops'],
      read: async () => null,
      cache,
      now: NOW,
    });
    assert.deepEqual(result, { kind: 'unavailable' });
    assert.deepEqual(cache.written, [], 'nothing may be cached from a failed read');
  });

  it('caches the server answer and reports agreement', async () => {
    const cache = recordingCache();
    const result = await revalidateStorefrontCapabilities({
      slug: 'coffee-story',
      bundled: ['growth-drops', 'commerce-catering'],
      read: async () => ['commerce-catering', 'growth-drops'],
      cache,
      now: NOW,
    });
    assert.equal(result.kind, 'match');
    assert.deepEqual(JSON.parse(cache.written[0] ?? '{}'), {
      slug: 'coffee-story',
      checkedAt: '2026-09-03T18:45:00.000Z',
      moduleKeys: ['commerce-catering', 'growth-drops'],
    });
  });

  it('reports both directions of drift without acting on either', async () => {
    const result = await revalidateStorefrontCapabilities({
      slug: 'coffee-story',
      bundled: ['growth-drops', 'growth-referrals'],
      read: async () => ['growth-drops', 'commerce-delivery'],
      cache: recordingCache(),
      now: NOW,
    });
    assert.equal(result.kind, 'drift');
    if (result.kind !== 'drift') return;
    assert.deepEqual(result.granted, ['commerce-delivery']);
    assert.deepEqual(result.revoked, ['growth-referrals']);
  });

  it('does not read a withheld module as drift', async () => {
    // The projection publishes customer-facing modules only. A kiosk binary
    // bundling local-printing and device-wall is not out of date with a server
    // that correctly declines to mention them.
    const result = await revalidateStorefrontCapabilities({
      slug: 'coffee-story',
      bundled: ['growth-drops', 'local-printing', 'device-wall', 'workforce-operations'],
      read: async () => ['growth-drops'],
      cache: recordingCache(),
      now: NOW,
    });
    assert.equal(result.kind, 'match');
  });

  it('caches the answer even when it disagrees with the binary', async () => {
    const cache = recordingCache();
    await revalidateStorefrontCapabilities({
      slug: 'coffee-story',
      bundled: [],
      read: async () => ['growth-drops'],
      cache,
      now: NOW,
    });
    assert.equal(cache.written.length, 1, 'a drifted answer is the one most worth keeping');
  });
});
