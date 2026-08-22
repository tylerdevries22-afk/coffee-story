import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addAppointmentToCalendar,
  shouldSimulateNativeFlow,
  usesSimulatedNativeFlows,
} from './native-adapters';

test('simulates native flows for Demo mode or Expo Go', () => {
  assert.equal(shouldSimulateNativeFlow(true, null), true);
  assert.equal(shouldSimulateNativeFlow(false, 'expo'), true);
  assert.equal(shouldSimulateNativeFlow(false, 'standalone'), false);
});

test('reports whether the current runtime uses simulated flows', () => {
  assert.equal(usesSimulatedNativeFlows(false, 'expo'), true);
});

test('rejects invalid appointment dates before requesting native permissions', async () => {
  await assert.rejects(() => addAppointmentToCalendar({
    slug: 'swedish-60',
    name: 'Swedish Massage',
    category: 'therapeutic',
    durationMin: 60,
    priceCents: 10500,
    depositCents: 2500,
  }, 'invalid-date', false, null), /invalid start time/i);
});
