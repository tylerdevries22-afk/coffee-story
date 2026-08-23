import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addOrderToCalendar,
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

test('rejects invalid pickup times before requesting native permissions', async () => {
  await assert.rejects(() => addOrderToCalendar({
    summary: 'Spanish Latte (16 oz)',
    durationMin: 60,
  }, 'invalid-date', false, null), /invalid pickup time/i);
});
