import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  itemsFor, outstandingAtClose, progressOf, toggleItem, type ChecklistItem,
} from './checklist';

const item = (
  id: string,
  recurrence: ChecklistItem['recurrence'],
  sortOrder: number,
  completedAt: string | null = null,
): ChecklistItem => ({
  id, title: id, detail: '', recurrence, sortOrder, completedAt,
  completedBy: completedAt ? 'user-1' : null,
});

const LIST: readonly ChecklistItem[] = [
  item('grinder', 'opening', 2),
  item('unlock', 'opening', 1, '2026-08-23T13:05:00Z'),
  item('counts', 'closing', 1),
  item('waste', 'daily', 1),
];

describe('itemsFor', () => {
  it('returns one list, in its own order', () => {
    assert.deepEqual(itemsFor(LIST, 'opening').map((i) => i.id), ['unlock', 'grinder']);
  });

  it('is empty for a recurrence with nothing on it', () => {
    assert.deepEqual(itemsFor([], 'closing'), []);
  });
});

describe('progressOf', () => {
  it('counts ticked against total', () => {
    assert.deepEqual(progressOf(itemsFor(LIST, 'opening')), { done: 1, total: 2 });
  });

  it('is 0 of 0 for an empty list rather than NaN', () => {
    assert.deepEqual(progressOf([]), { done: 0, total: 0 });
  });
});

describe('toggleItem', () => {
  it('ticks an item with who and when', () => {
    const next = toggleItem(LIST, 'grinder', 'sara', '2026-08-23T13:10:00Z');
    const ticked = next.find((i) => i.id === 'grinder');
    assert.equal(ticked?.completedAt, '2026-08-23T13:10:00Z');
    assert.equal(ticked?.completedBy, 'sara');
  });

  it('un-ticks, because a list people cannot correct is a list they stop trusting', () => {
    const next = toggleItem(LIST, 'unlock', 'sara', '2026-08-23T13:10:00Z');
    const cleared = next.find((i) => i.id === 'unlock');
    assert.equal(cleared?.completedAt, null);
    assert.equal(cleared?.completedBy, null);
  });

  it('leaves every other item alone', () => {
    const next = toggleItem(LIST, 'grinder', 'sara', '2026-08-23T13:10:00Z');
    assert.equal(next.find((i) => i.id === 'unlock')?.completedAt, '2026-08-23T13:05:00Z');
    assert.equal(next.find((i) => i.id === 'counts')?.completedAt, null);
  });

  it('ignores an id that is not on the list', () => {
    assert.deepEqual(toggleItem(LIST, 'nope', 'sara', '2026-08-23T13:10:00Z'), LIST);
  });
});

describe('outstandingAtClose', () => {
  it('still counts an opening job nobody did', () => {
    // Hiding it because the list is called "opening" is how it stays undone.
    assert.deepEqual(outstandingAtClose(LIST).map((i) => i.id), ['counts', 'grinder']);
  });

  it('excludes the daily list, which is not a gate on closing', () => {
    assert.ok(!outstandingAtClose(LIST).some((i) => i.recurrence === 'daily'));
  });

  it('is empty when the shift is actually done', () => {
    const finished = LIST.map((i) => ({ ...i, completedAt: '2026-08-23T21:00:00Z' }));
    assert.deepEqual(outstandingAtClose(finished), []);
  });
});
