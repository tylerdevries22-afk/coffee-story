import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { demoScreenFrom, recordDemoScreenView } from './demo-events';
import { fakeDemoDb } from './demo-site.test-support';
import { newDemoToken } from './demo-token';

const NOW = new Date('2026-09-18T12:00:00Z');
const LATER = '2026-10-02T12:00:00Z';
const READY = { id: 's1', state: 'ready', business_name: 'Harbor', expires_at: LATER };

describe('demoScreenFrom', () => {
  it('accepts a screen.viewed body with a bounded screen key', () => {
    assert.equal(demoScreenFrom({ event: 'screen.viewed', screen: 'home' }), 'home');
    assert.equal(demoScreenFrom({ event: 'screen.viewed', screen: 'order_review', extra: 'ignored' }), 'order_review');
  });

  it('refuses any event other than screen.viewed', () => {
    assert.equal(demoScreenFrom({ event: 'interaction.completed', screen: 'home' }), null);
    assert.equal(demoScreenFrom({ screen: 'home' }), null);
  });

  it('refuses a screen key that is missing, mistyped or out of shape', () => {
    for (const screen of [undefined, 42, '', 'Home', 'has space', 'semi;colon', '_leading', 'a'.repeat(65)]) {
      assert.equal(demoScreenFrom({ event: 'screen.viewed', screen }), null, JSON.stringify(screen));
    }
  });

  it('refuses a body that is not a plain object', () => {
    for (const body of [null, undefined, 'screen.viewed', 42, ['screen.viewed']]) {
      assert.equal(demoScreenFrom(body), null);
    }
  });
});

describe('recordDemoScreenView', () => {
  it('records a view against the site the cookie names, never the raw token', async () => {
    const token = newDemoToken();
    const { db, calls } = fakeDemoDb({ row: READY });
    const outcome = await recordDemoScreenView(token, { event: 'screen.viewed', screen: 'home' }, {
      db, clientLimited: false, siteLimited: () => false, now: NOW,
    });
    assert.equal(outcome, 'accepted');
    assert.deepEqual(calls.find((call) => call.kind === 'insert')?.args,
      ['platform_demo_events', { site_id: 's1', screen: 'home' }]);
    assert.equal(JSON.stringify(calls).includes(token), false, 'the raw token reached the database');
  });

  it('stops at the per-client budget before ever touching the database', async () => {
    const { db, calls } = fakeDemoDb({ row: READY });
    const outcome = await recordDemoScreenView(newDemoToken(), { event: 'screen.viewed', screen: 'home' }, {
      db, clientLimited: true, siteLimited: () => false, now: NOW,
    });
    assert.equal(outcome, 'rate_limited');
    assert.deepEqual(calls, []);
  });

  it('rejects a malformed body before touching the database', async () => {
    const { db, calls } = fakeDemoDb({ row: READY });
    const outcome = await recordDemoScreenView(newDemoToken(), { event: 'click' }, {
      db, clientLimited: false, siteLimited: () => false, now: NOW,
    });
    assert.equal(outcome, 'invalid');
    assert.deepEqual(calls, []);
  });

  it('is unavailable with no database configured', async () => {
    const outcome = await recordDemoScreenView(newDemoToken(), { event: 'screen.viewed', screen: 'home' }, {
      db: null, clientLimited: false, siteLimited: () => false, now: NOW,
    });
    assert.equal(outcome, 'unavailable');
  });

  it('is not_found for a token that resolves to no live site', async () => {
    const { db } = fakeDemoDb({ row: null });
    const outcome = await recordDemoScreenView(newDemoToken(), { event: 'screen.viewed', screen: 'home' }, {
      db, clientLimited: false, siteLimited: () => false, now: NOW,
    });
    assert.equal(outcome, 'not_found');
  });

  it('checks the per-site budget only once the site is known, and stops short of the insert', async () => {
    const { db, calls } = fakeDemoDb({ row: READY });
    const seen: string[] = [];
    const outcome = await recordDemoScreenView(newDemoToken(), { event: 'screen.viewed', screen: 'home' }, {
      db, clientLimited: false, siteLimited: (siteId) => { seen.push(siteId); return true; }, now: NOW,
    });
    assert.equal(outcome, 'rate_limited');
    assert.deepEqual(seen, ['s1']);
    assert.equal(calls.some((call) => call.kind === 'insert'), false);
  });

  it('surfaces a lookup failure instead of treating it as "no demo"', async () => {
    const { db } = fakeDemoDb({ selectError: { message: 'down' } });
    await assert.rejects(recordDemoScreenView(newDemoToken(), { event: 'screen.viewed', screen: 'home' }, {
      db, clientLimited: false, siteLimited: () => false, now: NOW,
    }));
  });

  it('surfaces an insert failure', async () => {
    const { db } = fakeDemoDb({ row: READY, insertError: { message: 'down' } });
    await assert.rejects(recordDemoScreenView(newDemoToken(), { event: 'screen.viewed', screen: 'home' }, {
      db, clientLimited: false, siteLimited: () => false, now: NOW,
    }));
  });
});
