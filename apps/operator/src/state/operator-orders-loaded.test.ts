import assert from 'node:assert/strict';
import test from 'node:test';

import { columnEmptyLabel, initialOrdersLoaded } from './operator-orders-loaded';

test('a plain local demo starts loaded: fixtures are synchronous', () => {
  assert.equal(initialOrdersLoaded(false, false), true);
});

test('a shared demo channel starts unloaded until the first reconcile', () => {
  assert.equal(initialOrdersLoaded(true, false), false);
});

test('a live tenant starts unloaded until the first fetch or realtime snapshot', () => {
  assert.equal(initialOrdersLoaded(false, true), false);
});

test('an empty column reads as loading before the board has loaded', () => {
  assert.equal(columnEmptyLabel(false), 'Loading orders…');
});

test('an empty column reads as genuinely empty once the board has loaded', () => {
  assert.equal(columnEmptyLabel(true), 'Nothing here.');
});
