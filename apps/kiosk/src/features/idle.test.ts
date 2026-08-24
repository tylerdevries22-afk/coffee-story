import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_IDLE_TIMING, IDLE_RESET_MS, IDLE_WARN_MS,
  idleFraction, idlePhase, secondsUntilReset,
} from './idle';

const T = DEFAULT_IDLE_TIMING;
const BUSY = { hasProgress: true, committed: false };
const IDLE_SCREEN = { hasProgress: false, committed: false };
const PAID = { hasProgress: true, committed: true };

describe('idlePhase', () => {
  it('warns before it resets, never instead of it', () => {
    assert.equal(idlePhase(0, T, BUSY), 'active');
    assert.equal(idlePhase(IDLE_WARN_MS, T, BUSY), 'warning');
    assert.equal(idlePhase(IDLE_RESET_MS, T, BUSY), 'reset');
    assert.ok(IDLE_RESET_MS > IDLE_WARN_MS);
  });

  it('never counts down a screen nobody has touched', () => {
    // An attract screen is the resting state, not an abandoned order. Counting
    // it would blank a lobby display every ninety seconds all day.
    assert.equal(idlePhase(IDLE_RESET_MS * 10, T, IDLE_SCREEN), 'active');
  });

  /**
   * The half-built-pack bug: four cookies into a six-pack is an empty cart and
   * a great deal of progress. The old `hasCart` predicate called that an
   * untouched screen and would neither warn nor clear it.
   */
  it('counts down a half-built pack even though the cart is still empty', () => {
    assert.equal(idlePhase(IDLE_WARN_MS, T, { hasProgress: true, committed: false }), 'warning');
  });

  /**
   * The tender bug: IdleNotice was mounted only on the order screen, so a
   * session abandoned at tender had its cart emptied under a live Pay button.
   * The notice now lives at the root, and this is what stops it firing on a
   * session that has already paid.
   */
  it('never clears a session that has committed to paying', () => {
    assert.equal(idlePhase(IDLE_RESET_MS * 10, T, PAID), 'active');
  });

  it('honours a tenant that gives its guests longer', () => {
    // A container tenant: filling a twelve-box takes longer than one latte.
    const slow = { warnMs: 90_000, resetMs: 150_000 };
    assert.equal(idlePhase(60_000, slow, BUSY), 'active');
    assert.equal(idlePhase(90_000, slow, BUSY), 'warning');
    assert.equal(idlePhase(150_000, slow, BUSY), 'reset');
  });

  it('refuses to reset before it warns, however incoherent the timing', () => {
    // A resolved config can never look like this (the domain resolver moves the
    // reset out); this guard is for a caller that has not hydrated yet.
    const inverted = { warnMs: 90_000, resetMs: 30_000 };
    assert.equal(idlePhase(60_000, inverted, BUSY), 'active');
    assert.equal(idlePhase(90_000, inverted, BUSY), 'warning');
    // Whatever the correction lands on, warning must strictly precede reset.
    assert.equal(idlePhase(89_999, inverted, BUSY), 'active');
    assert.equal(idlePhase(10_000_000, inverted, BUSY), 'reset');
  });
});

describe('secondsUntilReset', () => {
  it('counts whole seconds down to zero and stops there', () => {
    assert.equal(secondsUntilReset(IDLE_WARN_MS, T), 30);
    assert.equal(secondsUntilReset(IDLE_RESET_MS, T), 0);
    assert.equal(secondsUntilReset(IDLE_RESET_MS * 2, T), 0);
  });
});

describe('idleFraction', () => {
  it('starts the ring full at the moment the guest is first warned', () => {
    // An arc already three-quarters gone when it appears reads as a countdown
    // that has been running behind their back.
    assert.equal(idleFraction(IDLE_WARN_MS, T), 0);
    assert.equal(idleFraction(IDLE_RESET_MS, T), 1);
  });

  it('moves monotonically and stays inside 0..1', () => {
    let previous = -1;
    for (let ms = 0; ms <= IDLE_RESET_MS + 5_000; ms += 2_500) {
      const value = idleFraction(ms, T);
      assert.ok(value >= 0 && value <= 1, `out of range at ${ms}`);
      assert.ok(value >= previous, `went backwards at ${ms}`);
      previous = value;
    }
  });
});
