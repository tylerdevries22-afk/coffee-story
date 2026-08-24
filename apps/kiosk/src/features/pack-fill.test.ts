import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EMPTY_FILL, allocate, allocated, isComplete, packFingerprint, packSavingBps,
  packSummary, release, remaining, setQuantity, type PackFill,
  retainAllowedChoices,
} from './pack-fill';

const SIX = { packSize: 6 };

/** 2 x A + 4 x B -- the multiset a modifier group cannot express. */
const MIXED: PackFill = { a: 2, b: 4 };

describe('allocation', () => {
  it('accepts a multiset, not a set of distinct things', () => {
    assert.equal(allocated(MIXED), 6);
    assert.equal(isComplete(SIX, MIXED), true);
  });

  it('needs an exact count, so five of six is not complete', () => {
    assert.equal(isComplete(SIX, { a: 2, b: 3 }), false);
    assert.equal(remaining(SIX, { a: 2, b: 3 }), 1);
  });

  it('ignores a tap into a full box rather than replacing an earlier choice', () => {
    // A guest tapping a seventh cookie expects nothing to happen, not for one
    // of their first six to vanish.
    assert.deepEqual(allocate(SIX, MIXED, 'c'), MIXED);
    assert.equal(allocated(allocate(SIX, MIXED, 'c')), 6);
  });

  it('builds up one tap at a time', () => {
    let fill = EMPTY_FILL;
    for (const id of ['a', 'b', 'a', 'b', 'b', 'b']) fill = allocate(SIX, fill, id);
    assert.deepEqual(fill, MIXED);
  });

  it('drops a choice entirely at zero rather than leaving a zero behind', () => {
    assert.deepEqual(release({ a: 1 }, 'a'), {});
    assert.deepEqual(release({ a: 2 }, 'a'), { a: 1 });
    assert.deepEqual(release({ a: 1 }, 'missing'), { a: 1 });
  });

  it('removes a choice that becomes unavailable during a live fill', () => {
    const fill = { available: 2, soldOut: 4 };
    assert.deepEqual(retainAllowedChoices(fill, ['available']), { available: 2 });
    assert.equal(isComplete(SIX, retainAllowedChoices(fill, ['available'])), false);
    assert.equal(retainAllowedChoices(fill, ['available', 'soldOut']), fill);
  });

  it('clamps a typed quantity to what the box can still hold', () => {
    assert.deepEqual(setQuantity(SIX, { a: 2 }, 'b', 99), { a: 2, b: 4 });
    assert.deepEqual(setQuantity(SIX, { a: 2, b: 4 }, 'b', 0), { a: 2 });
    assert.deepEqual(setQuantity(SIX, {}, 'a', 2.7), { a: 2 });
  });

  it('treats a nonsense spec as a box with no room, not as an infinite one', () => {
    assert.equal(remaining({ packSize: 0 }, {}), 0);
    assert.equal(remaining({ packSize: Number.NaN }, {}), 0);
    assert.deepEqual(allocate({ packSize: 0 }, {}, 'a'), {});
    assert.equal(isComplete({ packSize: 0 }, {}), false);
  });

  it('never treats fractional, negative, or empty-id state as complete', () => {
    assert.equal(isComplete(SIX, { a: 7, b: -1 }), false);
    assert.equal(isComplete(SIX, { a: 5.5, b: 0.5 }), false);
    assert.equal(isComplete(SIX, { '': 6 }), false);
  });
});

describe('packFingerprint', () => {
  it('is order-independent, so the same box is one bag line however it was tapped', () => {
    const abba = allocate(SIX, allocate(SIX, allocate(SIX, EMPTY_FILL, 'a'), 'b'), 'a');
    const aabb = allocate(SIX, allocate(SIX, allocate(SIX, EMPTY_FILL, 'a'), 'a'), 'b');
    assert.equal(packFingerprint(abba), packFingerprint(aabb));
  });

  it('separates boxes that really do differ', () => {
    assert.notEqual(packFingerprint({ a: 2, b: 4 }), packFingerprint({ a: 3, b: 3 }));
    assert.notEqual(packFingerprint({ a: 6 }), packFingerprint({ b: 6 }));
  });

  it('ignores an empty box the same way every time', () => {
    assert.equal(packFingerprint(EMPTY_FILL), '');
  });
});

describe('packSummary', () => {
  it('names a single without a count and a repeat with one', () => {
    assert.equal(packSummary({ a: 1, b: 4 }, (id) => id.toUpperCase()), 'A, 4 × B');
  });
});

describe('packSavingBps', () => {
  /**
   * Pinned against app.pack_saving_bps (migration 0029):
   *   greatest(0, (single * size - pack) * 10000 / nullif(single * size, 0))
   * Postgres divides integers by truncating, so this must truncate too --
   * rounding would advertise a saving the database does not agree with.
   */
  it('matches the SQL formula, truncating rather than rounding', () => {
    // 6 x 478 = 2868; a 2398 pack saves 470/2868 = 16.38...% -> 1638 bps.
    assert.equal(packSavingBps(478, 2398, 6), 1638);
    // A case whose exact quotient has a fraction that would round up.
    assert.equal(packSavingBps(300, 1700, 6), Math.trunc(((1800 - 1700) * 10000) / 1800));
  });

  it('reports no saving rather than a negative one when a pack costs more', () => {
    // A shelf must never advertise a loss as a saving.
    assert.equal(packSavingBps(400, 2600, 6), 0);
  });

  it('reports nothing when there is no single to compare against', () => {
    assert.equal(packSavingBps(0, 2398, 6), 0);
    assert.equal(packSavingBps(478, 2398, 0), 0);
  });
});
