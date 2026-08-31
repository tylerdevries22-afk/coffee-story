import assert from 'node:assert/strict';
import test from 'node:test';

import { fontGateReady } from './font-gate';

test('keeps holding the splash while the brand fonts are still loading', () => {
  assert.equal(fontGateReady(false, null), false);
});

test('releases the splash once the brand fonts have loaded', () => {
  assert.equal(fontGateReady(true, null), true);
});

test('releases the splash when font loading fails, rather than stranding the app', () => {
  // The regression this guards: `useFonts` never flips `loaded` after an error,
  // so gating on `loaded` alone held the native splash forever.
  assert.equal(fontGateReady(false, new Error('font download failed')), true);
});

test('treats a late error alongside a successful load as ready', () => {
  assert.equal(fontGateReady(true, new Error('one face failed')), true);
});
