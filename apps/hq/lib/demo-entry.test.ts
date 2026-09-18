import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEMO_COOKIE, demoCookie, demoEntry } from './demo-entry';
import { fakeDemoDb } from './demo-site.test-support';
import { newDemoToken } from './demo-token';

const NOW = new Date('2026-09-18T12:00:00Z');
const BUILDER = { name: 'Example Studio', contactHref: null };

function deps(overrides: Partial<Parameters<typeof demoEntry>[1]> = {}) {
  return { db: fakeDemoDb().db, builder: BUILDER, limited: false, now: NOW, secure: true, ...overrides };
}

describe('demoEntry', () => {
  it('opens a live demo and hands the token to an httpOnly cookie for exactly its window', async () => {
    const token = newDemoToken();
    const { db } = fakeDemoDb({ rpcData: [{ id: 's1', expires_at: '2026-09-25T12:00:00Z' }] });
    const outcome = await demoEntry(token, deps({ db }));
    assert.equal(outcome.kind, 'opened');
    assert.ok(outcome.kind === 'opened');
    assert.deepEqual(outcome.cookie, {
      name: DEMO_COOKIE, value: token,
      options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600 },
    });
  });

  it('keeps an unopened link\'s cookie for an hour, long enough to explain why', async () => {
    const outcome = await demoEntry(newDemoToken(), deps({ db: fakeDemoDb({ rpcData: [] }).db }));
    assert.ok(outcome.kind === 'unopened');
    assert.equal(outcome.cookie.options.maxAge, 3600);
  });

  it('checks the limit, then the shape, then the configuration -- before the database', async () => {
    const { db, calls } = fakeDemoDb();
    assert.equal((await demoEntry(newDemoToken(), deps({ db, limited: true }))).kind, 'rate_limited');
    assert.equal((await demoEntry('not-a-token', deps({ db }))).kind, 'invalid');
    assert.equal((await demoEntry(newDemoToken(), deps({ db, builder: null }))).kind, 'unavailable');
    assert.equal((await demoEntry(newDemoToken(), deps({ db: null }))).kind, 'unavailable');
    assert.deepEqual(calls, []);
  });

  it('turns a database failure into "unavailable", not a crash or a false "gone"', async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const outcome = await demoEntry(newDemoToken(), deps({ db: fakeDemoDb({ rpcError: { message: 'down' } }).db }));
      assert.equal(outcome.kind, 'unavailable');
    } finally {
      console.error = original;
    }
  });
});

describe('demoCookie', () => {
  it('never outlives the two-week window, and never drops below a minute', () => {
    assert.equal(demoCookie('t', '2027-01-01T00:00:00Z', NOW, true).options.maxAge, 14 * 24 * 3600);
    assert.equal(demoCookie('t', '2026-09-18T12:00:10Z', NOW, true).options.maxAge, 60);
    assert.equal(demoCookie('t', 'not a date', NOW, true).options.maxAge, 3600);
  });

  it('is Secure wherever the deployment is', () => {
    assert.equal(demoCookie('t', null, NOW, false).options.secure, false);
    assert.equal(demoCookie('t', null, NOW, true).options.secure, true);
  });
});
