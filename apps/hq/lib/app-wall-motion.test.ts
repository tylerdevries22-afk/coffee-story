import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EASING, SPRING } from '@platform/ui/motion';

import { cubicBezierVar, springTransition, TURN_DEGREES } from './app-wall-motion';

test('spring transitions spread the shared preset', () => {
  const transition = springTransition('settle', false, { velocity: 120 });
  assert.deepEqual(transition, { type: 'spring', ...SPRING.settle, restDelta: .001, restSpeed: .01, velocity: 120 });
});

test('reduced motion collapses every transition to zero duration', () => {
  for (const preset of Object.keys(SPRING) as (keyof typeof SPRING)[]) {
    assert.deepEqual(springTransition(preset, true, { velocity: 900 }), { duration: 0 });
  }
});

test('cubicBezierVar formats an EASING tuple', () => {
  assert.equal(cubicBezierVar(EASING.enter), 'cubic-bezier(0.16, 1, 0.3, 1)');
  assert.equal(TURN_DEGREES, 90);
});
