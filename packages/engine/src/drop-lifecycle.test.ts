import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { dropVisibility, dueDropTransitions, type DropJobRow } from './jobs';

/**
 * The lineup's clock.
 *
 * Table-driven over a frozen `now` because this is the easiest thing in the
 * build to get subtly wrong: every branch is a comparison against a timestamp,
 * and the failure mode is a screen showing next week's item today rather than
 * anything that throws.
 */
const REVEAL = '2026-08-23T00:00:00.000Z';  // Sunday evening
const START = '2026-08-24T14:00:00.000Z';   // Monday open
const END = '2026-08-31T14:00:00.000Z';     // the following Monday

function drop(over: Partial<DropJobRow> = {}): DropJobRow {
  return { id: 'd1', status: 'scheduled', revealAt: REVEAL, startsAt: START, endsAt: END, ...over };
}

const at = (iso: string) => new Date(iso);

describe('dropVisibility', () => {
  const cases: [string, string, ReturnType<typeof dropVisibility>][] = [
    ['before the reveal', '2026-08-22T12:00:00.000Z', 'hidden'],
    ['exactly at the reveal', REVEAL, 'revealed'],
    ['between reveal and open', '2026-08-24T08:00:00.000Z', 'revealed'],
    ['exactly at open', START, 'orderable'],
    ['mid-window', '2026-08-27T12:00:00.000Z', 'orderable'],
    ['exactly at close', END, 'ended'],
    ['after close', '2026-09-02T12:00:00.000Z', 'ended'],
  ];
  for (const [label, when, expected] of cases) {
    it(`is ${expected} ${label}`, () => {
      assert.equal(dropVisibility(drop(), at(when)), expected);
    });
  }

  it('hides a drop with no reveal until it opens', () => {
    const d = drop({ revealAt: null });
    assert.equal(dropVisibility(d, at('2026-08-24T08:00:00.000Z')), 'hidden');
    assert.equal(dropVisibility(d, at(START)), 'orderable');
  });

  it('hides a draft and a cancelled drop at every moment', () => {
    for (const status of ['draft', 'cancelled'] as const) {
      for (const when of [REVEAL, START, '2026-08-27T12:00:00.000Z']) {
        assert.equal(dropVisibility(drop({ status }), at(when)), 'hidden');
      }
    }
  });
});

describe('dueDropTransitions', () => {
  it('reveals, then opens, then closes', () => {
    assert.deepEqual(dueDropTransitions([drop()], at(REVEAL)), [{ id: 'd1', to: 'revealed' }]);
    assert.deepEqual(
      dueDropTransitions([drop({ status: 'revealed' })], at(START)),
      [{ id: 'd1', to: 'live' }],
    );
    assert.deepEqual(
      dueDropTransitions([drop({ status: 'live' })], at(END)),
      [{ id: 'd1', to: 'ended' }],
    );
  });

  it('goes straight to live when a tick slept through the reveal', () => {
    // A deploy or a cold start can drop a tick. The drop must not sit at
    // 'scheduled' waiting for an edge that has already passed.
    assert.deepEqual(
      dueDropTransitions([drop()], at('2026-08-24T15:00:00.000Z')),
      [{ id: 'd1', to: 'live' }],
    );
  });

  it('goes straight to ended when a tick slept through the whole window', () => {
    assert.deepEqual(
      dueDropTransitions([drop()], at('2026-09-05T00:00:00.000Z')),
      [{ id: 'd1', to: 'ended' }],
    );
  });

  it('never moves a draft or a cancelled drop', () => {
    for (const status of ['draft', 'cancelled'] as const) {
      assert.deepEqual(dueDropTransitions([drop({ status })], at('2026-09-05T00:00:00.000Z')), []);
    }
  });

  it('is idempotent: a state already reached is not re-emitted', () => {
    assert.deepEqual(dueDropTransitions([drop({ status: 'revealed' })], at(REVEAL)), []);
    assert.deepEqual(dueDropTransitions([drop({ status: 'live' })], at(START)), []);
    assert.deepEqual(dueDropTransitions([drop({ status: 'ended' })], at(END)), []);
  });

  it('emits nothing before the reveal', () => {
    assert.deepEqual(dueDropTransitions([drop()], at('2026-08-22T12:00:00.000Z')), []);
  });
});
