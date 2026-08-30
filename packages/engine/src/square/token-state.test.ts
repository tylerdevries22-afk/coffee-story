import assert from 'node:assert/strict';
import test from 'node:test';

import { SQUARE_REFRESH_MARGIN_MS, squareTokenState } from './client';

const NOW = Date.parse('2026-08-30T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

test('leaves a token with room to spare alone', () => {
  assert.equal(squareTokenState(at(SQUARE_REFRESH_MARGIN_MS + 60_000), NOW), 'fresh');
});

test('renews inside the margin, while the token still spends', () => {
  assert.equal(squareTokenState(at(SQUARE_REFRESH_MARGIN_MS), NOW), 'refresh_soon');
  assert.equal(squareTokenState(at(60_000), NOW), 'refresh_soon');
});

test('calls an elapsed token expired, not merely stale', () => {
  // The difference decides whether a failed renewal still takes the sale.
  assert.equal(squareTokenState(at(0), NOW), 'expired');
  assert.equal(squareTokenState(at(-1), NOW), 'expired');
});

test('renews rather than refuses when the expiry is missing or unreadable', () => {
  // Connections stored before this was checked have to keep working.
  assert.equal(squareTokenState(null, NOW), 'refresh_soon');
  assert.equal(squareTokenState(undefined, NOW), 'refresh_soon');
  assert.equal(squareTokenState('', NOW), 'refresh_soon');
  assert.equal(squareTokenState('whenever', NOW), 'refresh_soon');
});
