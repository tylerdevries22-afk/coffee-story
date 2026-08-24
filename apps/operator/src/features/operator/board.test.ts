import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  boardColumns,
  canCancelWithoutRefund,
  newOrderIds,
  nextActionFor,
  packContentsLabel,
  type BoardOrder,
} from './board';

const NOW = new Date('2026-08-22T12:00:00Z');
const order = (id: string, status: BoardOrder['status'], placedAt: string, scheduledFor: string | null = null): BoardOrder => ({
  dailyNumber: null,
  updatedAt: placedAt,
  id, shortCode: id.toUpperCase(), guestName: 'G', status, placedAt, scheduledFor,
  lines: [{ name: 'Cortado', quantity: 1, options: [] }], totalCents: 450, note: '',
  tenderType: 'square_card',
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

  it('never shows terminal or unpaid processor orders', () => {
    const columns = boardColumns([
      order('x', 'created', '2026-08-22T11:00:00Z'),
      order('y', 'picked_up', '2026-08-22T11:00:00Z'),
      order('z', 'refunded', '2026-08-22T11:00:00Z'),
    ], NOW);
    assert.equal(columns.paid.length + columns.in_progress.length + columns.ready.length + columns.scheduled.length, 0);
  });

  it('puts pay-at-pickup orders in New until staff collects them', () => {
    const due = { ...order('cash', 'created', '2026-08-22T11:00:00Z'), tenderType: 'pay_at_pickup' as const };
    const columns = boardColumns([due], NOW);
    assert.deepEqual(columns.paid.map((entry) => entry.id), ['cash']);
    assert.deepEqual(nextActionFor(due), { to: 'paid', label: 'Mark paid' });
    assert.equal(nextActionFor(order('card', 'created', '2026-08-22T11:00:00Z')), null);
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

  it('alerts once for a new payment-due order', () => {
    const due = { ...order('cash', 'created', '2026-08-22T11:59:00Z'), tenderType: 'pay_at_pickup' as const };
    assert.deepEqual(newOrderIds(new Set(), [due]), ['cash']);
    assert.deepEqual(newOrderIds(new Set(['cash']), [due]), []);
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

describe('canCancelWithoutRefund', () => {
  it('allows only an unpaid pay-at-pickup order', () => {
    const createdPickup = {
      ...order('cash-created', 'created', '2026-08-22T11:00:00Z'),
      tenderType: 'pay_at_pickup' as const,
    };
    const paidPickup = { ...createdPickup, status: 'paid' as const };
    assert.equal(canCancelWithoutRefund(createdPickup), true);
    assert.equal(canCancelWithoutRefund(paidPickup), false);
    assert.equal(canCancelWithoutRefund(order('card', 'paid', '2026-08-22T11:00:00Z')), false);
  });
});

describe('packContentsLabel', () => {
  it('formats the exact per-box recipe for fulfillment', () => {
    assert.equal(packContentsLabel([
      { name: 'Ethiopia', quantity: 3 },
      { name: 'Kenya', quantity: 1 },
    ]), 'Inside each box: 3× Ethiopia · 1× Kenya');
    assert.equal(packContentsLabel([]), null);
  });
});
