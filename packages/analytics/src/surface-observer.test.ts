import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnalyticsSurfaceObserver } from './surface-observer';

const BRAND_ID = 'e627d6c2-6cb9-4368-8543-abd02a5afb7c';

test('surface observer emits a session once, deduplicates screens, and rotates identities', () => {
  const events: { eventName: string; properties: unknown }[] = [];
  const observer = createAnalyticsSurfaceObserver({
    enqueue: (value) => { events.push({ eventName: value.eventName, properties: value.properties }); },
  }, {
    createId: (() => {
      let id = 0;
      return () => `40000000-0000-4000-8000-${String(++id).padStart(12, '0')}`;
    })(),
    createSessionHash: () => 'h1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    now: () => new Date('2026-08-27T18:00:00.000Z'),
  });
  const observation = {
    context: {
      brandId: BRAND_ID,
      surface: 'customer' as const,
      appVersion: '1.0.0',
      consent: { essential: true as const, behavioral: true, source: 'user' as const, updatedAt: '2026-08-27T18:00:00.000Z' },
    },
    screenKey: 'home',
    sessionIdentity: 'user-1:allowed',
  };
  assert.equal(observer.observe(observation), 2);
  assert.equal(observer.observe(observation), 0);
  assert.equal(observer.observe({ ...observation, screenKey: 'orders' }), 1);
  assert.equal(observer.observe({ ...observation, sessionIdentity: 'user-2:allowed' }), 2);
  assert.deepEqual(events.map((value) => value.eventName), [
    'session.started', 'screen.viewed', 'screen.viewed', 'session.started', 'screen.viewed',
  ]);
});
