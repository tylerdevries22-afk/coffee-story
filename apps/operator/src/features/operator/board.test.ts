import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { boardColumns, newOrderIds, nextActionFor, type BoardOrder } from './board';

const NOW = new Date('2026-08-22T12:00:00Z');
const order = (id: string, status: BoardOrder['status'], placedAt: string, scheduledFor: string | null = null): BoardOrder => ({
  dailyNumber: null,
  updatedAt: placedAt,
  id, shortCode: id.toUpperCase(), guestName: 'G', status, placedAt, scheduledFor,
  lines: [{ name: 'Cortado', quantity: 1, options: [] }], totalCents: 450, note: '',
});

describe('boardColumns', () => {
  it('files each order under its column, oldest first', () => {
    const columns = boardColumns([
      order('b', 'paid', '2026-08-22T11:50:00Z'),
      order('a', 'paid', '2026-08-22T11:40:00Z'),
      order('c', 'in_progress', '2026-08-22T11:45:00Z'),
      order('d', 'ready', '2026-08-22T11:30:00Z'),
    ], NOW);
    assert.deepEqual(columns.paid.map((o) => o.id), ['a', 'b']);
    assert.deepEqual(columns.in_progress.map((o) => o.id), ['c']);
    assert.deepEqual(columns.ready.map((o) => o.id), ['d']);
  });

  it('holds far-out scheduled orders in the lane, not the board', () => {
    const columns = boardColumns([
      order('later', 'paid', '2026-08-22T11:00:00Z', '2026-08-22T14:00:00Z'),
      order('soon', 'paid', '2026-08-22T11:00:00Z', '2026-08-22T12:15:00Z'),
    ], NOW);
    assert.deepEqual(columns.scheduled.map((o) => o.id), ['later']);
    // Inside the 30-minute window it joins the working queue.
    assert.deepEqual(columns.paid.map((o) => o.id), ['soon']);
  });

  it('keeps a scheduled order in progress on the board, never back in the lane', () => {
    const columns = boardColumns([
      order('working', 'in_progress', '2026-08-22T11:00:00Z', '2026-08-22T14:00:00Z'),
    ], NOW);
    assert.deepEqual(columns.in_progress.map((o) => o.id), ['working']);
    assert.equal(columns.scheduled.length, 0);
  });

  it('never shows terminal or unpaid orders', () => {
    const columns = boardColumns([
      order('x', 'created', '2026-08-22T11:00:00Z'),
      order('y', 'picked_up', '2026-08-22T11:00:00Z'),
      order('z', 'refunded', '2026-08-22T11:00:00Z'),
    ], NOW);
    assert.equal(columns.paid.length + columns.in_progress.length + columns.ready.length + columns.scheduled.length, 0);
  });
});

describe('newOrderIds', () => {
  it('reports only unseen paid orders', () => {
    const seen = new Set(['a']);
    const ids = newOrderIds(seen, [
      order('a', 'paid', '2026-08-22T11:00:00Z'),
      order('b', 'paid', '2026-08-22T11:59:00Z'),
      order('c', 'ready', '2026-08-22T11:59:00Z'),
    ]);
    assert.deepEqual(ids, ['b']);
  });
});

describe('nextActionFor', () => {
  it('offers exactly the legal advance for each working column', () => {
    assert.deepEqual(nextActionFor('paid'), { to: 'in_progress', label: 'Start' });
    assert.deepEqual(nextActionFor('in_progress'), { to: 'ready', label: 'Ready' });
    assert.deepEqual(nextActionFor('ready'), { to: 'picked_up', label: 'Picked up' });
    assert.equal(nextActionFor('refunded'), null);
  });
});
