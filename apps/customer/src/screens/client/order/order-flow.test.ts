import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overlayAtLeast, setupAtLeast } from './order-flow';

test('checkout keeps the bag and note presented underneath it', () => {
  assert.equal(overlayAtLeast('checkout', 'bag'), true);
  assert.equal(overlayAtLeast('checkout', 'note'), true);
  assert.equal(overlayAtLeast('checkout', 'checkout'), true);
  assert.equal(overlayAtLeast('checkout', 'placed'), false);
});

test('back from checkout reveals the note without presenting checkout or confirmation', () => {
  assert.equal(overlayAtLeast('note', 'bag'), true);
  assert.equal(overlayAtLeast('note', 'note'), true);
  assert.equal(overlayAtLeast('note', 'checkout'), false);
  assert.equal(overlayAtLeast('note', 'placed'), false);
});

test('resetting the order removes all covering pages', () => {
  for (const page of ['bag', 'note', 'checkout', 'placed'] as const) {
    assert.equal(overlayAtLeast('none', page), false);
    assert.equal(overlayAtLeast('placed', page), true);
  }
  assert.equal(setupAtLeast('hub', 'place'), false);
  assert.equal(setupAtLeast('hub', 'details'), false);
});

test('details preserves the place page; back to place removes details', () => {
  assert.equal(setupAtLeast('details', 'place'), true);
  assert.equal(setupAtLeast('details', 'details'), true);
  assert.equal(setupAtLeast('place', 'details'), false);
});
