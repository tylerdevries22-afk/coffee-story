import assert from 'node:assert/strict';
import test from 'node:test';

import { scopeRowsToLocation } from './location-scope';

const rows = [
  { locationId: 'a', value: 1 },
  { locationId: 'b', value: 2 },
  { locationId: 'a', value: 3 },
];

test('a null scope returns every row (all locations)', () => {
  assert.deepEqual(scopeRowsToLocation(rows, null), rows);
});

test('a location scope keeps only that location’s rows', () => {
  assert.deepEqual(scopeRowsToLocation(rows, 'a'), [
    { locationId: 'a', value: 1 },
    { locationId: 'a', value: 3 },
  ]);
});

test('an unknown location scopes to nothing rather than leaking', () => {
  assert.deepEqual(scopeRowsToLocation(rows, 'zzz'), []);
});

test('the result is a copy, never the caller’s array', () => {
  assert.notEqual(scopeRowsToLocation(rows, null), rows);
});
