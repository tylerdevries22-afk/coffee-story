import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { demoMedia, openDemoSite, readySiteId, removeDemoSite, siteView, viewDemoSite } from './demo-site';
import { fakeDemoDb } from './demo-site.test-support';
import { demoTokenHash, newDemoToken } from './demo-token';

const NOW = new Date('2026-09-18T12:00:00Z');
const LATER = '2026-10-02T12:00:00Z';
const EARLIER = '2026-09-17T12:00:00Z';

describe('siteView', () => {
  it('shows a ready demo only inside its window', () => {
    assert.equal(siteView({ id: 's1', state: 'ready', business_name: 'Harbor', expires_at: LATER, pack: {} }, NOW).state, 'ready');
    // Past its window but not yet swept: already expired, to the minute.
    assert.deepEqual(siteView({ id: 's1', state: 'ready', business_name: 'Harbor', expires_at: EARLIER }, NOW),
      { state: 'expired', businessName: 'Harbor' });
    assert.deepEqual(siteView({ state: 'expired', business_name: 'Harbor' }, NOW), { state: 'expired', businessName: 'Harbor' });
  });

  it('shows nothing for a removed, unfinished or unknown demo', () => {
    for (const row of [null, {}, { state: 'removed', business_name: 'Removed' }, { state: 'building', expires_at: LATER },
      { state: 'ready', expires_at: LATER }]) {
      assert.deepEqual(siteView(row, NOW), { state: 'gone' });
    }
  });
});

describe('the database sees only the hash', () => {
  it('opens by hash and reports the expiry', async () => {
    const token = newDemoToken();
    const { db, calls } = fakeDemoDb({ rpcData: [{ id: 's1', expires_at: LATER }] });
    assert.equal(await openDemoSite(db, token), LATER);
    assert.deepEqual(calls, [{ kind: 'rpc', args: ['open_platform_demo_site', { p_token_hash: demoTokenHash(token) }] }]);
    assert.equal(JSON.stringify(calls).includes(token), false, 'the raw token reached the database');
  });

  it('reads the pack by hash', async () => {
    const token = newDemoToken();
    const { db, calls } = fakeDemoDb({ row: { id: 's1', state: 'ready', business_name: 'Harbor', expires_at: LATER, pack: { a: 1 } } });
    const view = await viewDemoSite(db, token, NOW);
    assert.equal(view.state, 'ready');
    assert.deepEqual(calls[0]?.args, ['platform_demo_sites', 'id,state,business_name,expires_at,pack', 'token_hash', demoTokenHash(token)]);
  });

  it('never queries for a malformed token', async () => {
    const { db, calls } = fakeDemoDb();
    assert.equal(await openDemoSite(db, 'short'), null);
    assert.deepEqual(await viewDemoSite(db, 'short'), { state: 'gone' });
    assert.equal(await removeDemoSite(db, 'x'.repeat(44)), false);
    assert.deepEqual(calls, []);
  });

  it('surfaces a database failure instead of treating it as "no demo"', async () => {
    const { db } = fakeDemoDb({ rpcError: { message: 'down' }, selectError: { message: 'down' } });
    await assert.rejects(openDemoSite(db, newDemoToken()));
    await assert.rejects(viewDemoSite(db, newDemoToken()));
  });
});

describe('removeDemoSite', () => {
  it('removes the row by hash, then every image in its folder', async () => {
    const { db, calls } = fakeDemoDb({ rpcData: [{ id: 's1' }], listed: [{ name: 'logo.webp' }, { name: 'latte.webp' }] });
    assert.equal(await removeDemoSite(db, newDemoToken()), true);
    assert.deepEqual(calls.slice(1), [
      { kind: 'list', args: ['demo-media', 's1'] },
      { kind: 'remove', args: ['demo-media', ['s1/logo.webp', 's1/latte.webp']] },
    ]);
  });

  // The business is already off every page; a stuck image is for the sweep,
  // not a reason to tell someone their removal failed.
  it('still reports success when image cleanup fails', async () => {
    const { db } = fakeDemoDb({ rpcData: [{ id: 's1' }], listed: [{ name: 'logo.webp' }], removeError: { message: 'x' } });
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(await removeDemoSite(db, newDemoToken()), true);
    } finally {
      console.error = original;
    }
  });

  it('touches no storage when there was nothing to remove', async () => {
    const { db, calls } = fakeDemoDb({ rpcData: [] });
    assert.equal(await removeDemoSite(db, newDemoToken()), false);
    assert.deepEqual(calls.map((call) => call.kind), ['rpc']);
  });
});

describe('readySiteId', () => {
  it('is the id behind a live link, and only a live one', async () => {
    const { db } = fakeDemoDb({ row: { id: 's1', state: 'ready', business_name: 'Harbor', expires_at: LATER } });
    assert.equal(await readySiteId(db, newDemoToken(), NOW), 's1');
  });

  it('is null for an expired, removed or unknown demo', async () => {
    const { db } = fakeDemoDb({ row: { id: 's1', state: 'ready', business_name: 'Harbor', expires_at: EARLIER } });
    assert.equal(await readySiteId(db, newDemoToken(), NOW), null);
    assert.equal(await readySiteId(db, 'short', NOW), null);
  });
});

describe('demoMedia', () => {
  const ready = { id: 's1', state: 'ready', business_name: 'Harbor', expires_at: LATER };

  it('serves an image from the live demo\'s own folder, without loading its pack', async () => {
    const { db, calls } = fakeDemoDb({ row: ready, download: new Blob([new Uint8Array([1, 2, 3])]) });
    const image = await demoMedia(db, newDemoToken(), 'latte.webp', NOW);
    assert.equal(image?.contentType, 'image/webp');
    assert.equal(image?.body.byteLength, 3);
    assert.equal(calls[0]?.args[1], 'id,state,business_name,expires_at');
    assert.deepEqual(calls[1]?.args, ['demo-media', 's1/latte.webp']);
  });

  it('refuses a name that could leave the folder before any lookup', async () => {
    const { db, calls } = fakeDemoDb({ row: ready });
    for (const name of ['../s2/logo.webp', 'logo.svg', 'a/b.png']) {
      assert.equal(await demoMedia(db, newDemoToken(), name, NOW), null, name);
    }
    assert.deepEqual(calls, []);
  });

  it('serves nothing for an expired demo', async () => {
    const { db, calls } = fakeDemoDb({ row: { ...ready, expires_at: EARLIER }, download: new Blob(['x']) });
    assert.equal(await demoMedia(db, newDemoToken(), 'latte.webp', NOW), null);
    assert.equal(calls.some((call) => call.kind === 'download'), false);
  });
});
