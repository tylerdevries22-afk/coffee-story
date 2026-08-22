import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dropPhase, formatCountdown } from './drop-countdown-logic';

const at = (iso: string) => new Date(iso);

describe('dropPhase', () => {
  it('walks upcoming -> live -> ended', () => {
    const starts = at('2026-08-22T10:00:00Z');
    const ends = at('2026-08-24T10:00:00Z');
    assert.equal(dropPhase(starts, ends, at('2026-08-22T09:59:59Z')), 'upcoming');
    assert.equal(dropPhase(starts, ends, at('2026-08-22T10:00:00Z')), 'live');
    assert.equal(dropPhase(starts, ends, at('2026-08-24T10:00:00Z')), 'ended');
  });
});

describe('formatCountdown', () => {
  const now = at('2026-08-22T10:00:00Z');
  it('coarsens with distance', () => {
    assert.equal(formatCountdown(at('2026-08-24T14:30:00Z'), now), '2d 4h');
    assert.equal(formatCountdown(at('2026-08-22T14:12:00Z'), now), '4h 12m');
    assert.equal(formatCountdown(at('2026-08-22T10:12:07Z'), now), '12:07');
  });

  it('pads seconds and clamps the past to zero', () => {
    assert.equal(formatCountdown(at('2026-08-22T10:00:05Z'), now), '0:05');
    assert.equal(formatCountdown(at('2026-08-22T09:00:00Z'), now), '0:00');
  });
});
