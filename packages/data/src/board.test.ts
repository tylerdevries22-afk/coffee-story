import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { BoardTicketRow } from '@platform/schema';

import { splitBoard } from './board';

function ticket(over: Partial<BoardTicketRow> & { id: string }): BoardTicketRow {
  return {
    brand_id: 'b',
    location_id: 'l',
    daily_number: 1,
    guest_label: 'Sara D.',
    status: 'paid',
    fulfillment_type: 'pickup',
    arrived_at: null,
    updated_at: '2026-08-23T10:00:00Z',
    ...over,
  };
}

describe('splitBoard', () => {
  it('puts paid and in-progress together, ready apart', () => {
    const board = splitBoard([
      ticket({ id: '1', status: 'paid' }),
      ticket({ id: '2', status: 'in_progress' }),
      ticket({ id: '3', status: 'ready' }),
    ]);
    assert.deepEqual(board.inProgress.map((t) => t.id), ['1', '2']);
    assert.deepEqual(board.ready.map((t) => t.id), ['3']);
  });

  it('shows no column for a state the guest cannot act on', () => {
    // The view already excludes collected and cancelled orders; if one ever
    // reached here it must not invent a third column.
    const board = splitBoard([
      ticket({ id: '1', status: 'picked_up' }),
      ticket({ id: '2', status: 'cancelled' }),
    ]);
    assert.deepEqual(board.inProgress, []);
    assert.deepEqual(board.ready, []);
  });

  it('is empty for an empty board rather than throwing', () => {
    assert.deepEqual(splitBoard([]), { inProgress: [], ready: [] });
  });
});
