import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BoardTicketRow, OrderRow } from '@platform/schema';

import { fetchBoardTickets, orderBoardEntryFromRow, orderCallout } from './board';

type Call = { table: string; select: string; eq: [string, string]; order: [string, unknown] };

/**
 * A client that records what was asked rather than answering it.
 *
 * The interesting properties of this read are not in its return value -- they
 * are in *which relation it reads*. Reading `orders` instead of
 * `board_tickets` would work, pass any behavioural test, and quietly put a
 * cart snapshot one column away from a screen the whole room can see.
 */
function recordingClient(rows: BoardTicketRow[], error?: { message: string }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call = { table } as Partial<Call> & { table: string };
      const builder = {
        select(select: string) { call.select = select; return builder; },
        eq(column: string, value: string) { call.eq = [column, value]; return builder; },
        order(column: string, options: unknown) { call.order = [column, options]; return builder; },
        returns() {
          calls.push(call as Call);
          return Promise.resolve({ data: error ? null : rows, error: error ?? null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

function ticket(over: Partial<BoardTicketRow> & { id: string }): BoardTicketRow {
  return {
    brand_id: 'b', location_id: 'l', daily_number: 1, guest_label: 'Sara D.',
    status: 'paid', fulfillment_type: 'pickup', channel: 'app',
    arrived_at: null, loyalty_tier: null, updated_at: '2026-08-23T10:00:00Z',
    ...over,
  };
}

describe('fetchBoardTickets', () => {
  it('reads the display-safe view, never the orders table', () => {
    const { client, calls } = recordingClient([]);
    void fetchBoardTickets(client, 'loc-1');
    assert.equal(calls[0]?.table, 'board_tickets');
  });

  it('scopes to one location, so one shop never shows another shop\'s queue', () => {
    const { client, calls } = recordingClient([]);
    void fetchBoardTickets(client, 'loc-1');
    assert.deepEqual(calls[0]?.eq, ['location_id', 'loc-1']);
  });

  it('orders by ticket number so the board reads like a queue', () => {
    const { client, calls } = recordingClient([]);
    void fetchBoardTickets(client, 'loc-1');
    assert.deepEqual(calls[0]?.order, ['daily_number', { ascending: true }]);
  });

  it('returns the rows it was given', async () => {
    const rows = [ticket({ id: '1' }), ticket({ id: '2', daily_number: 2 })];
    const { client } = recordingClient(rows);
    assert.deepEqual((await fetchBoardTickets(client, 'loc-1')).map((t) => t.id), ['1', '2']);
  });

  it('is empty rather than null for a board with nothing on it', async () => {
    const { client } = recordingClient([]);
    assert.deepEqual(await fetchBoardTickets(client, 'loc-1'), []);
  });

  it('throws with the underlying reason, which the display catches and degrades on', async () => {
    const { client } = recordingClient([], { message: 'permission denied' });
    await assert.rejects(() => fetchBoardTickets(client, 'loc-1'), /permission denied/);
  });
});

const ORDER: OrderRow = {
  id: 'order-1', brand_id: 'brand-1', location_id: 'location-1', customer_id: null,
  status: 'paid', fulfillment_type: 'pickup', channel: 'kiosk', device_id: null,
  scheduled_for: null, totals: { lines: [{ name: 'Latte', quantity: 1, options: ['Oat'] }] },
  subtotal_cents: 500, tax_cents: 40, tip_cents: 0, total_cents: 540,
  loyalty_redeemed_points: 0, stored_value_applied_cents: 0, note: '',
  service_date: '2026-08-24', daily_number: 47, guest_label: 'Sara D.', arrived_at: null,
  square_order_id: null, square_payment_id: null,
  created_at: '2026-08-24T10:00:00Z', updated_at: '2026-08-24T10:00:00Z',
};

describe('order call-out', () => {
  it('uses the daily number before the optional guest label', () => {
    assert.equal(orderCallout(ORDER), '47');
    assert.equal(orderCallout({ daily_number: null, guest_label: '  Sara D.  ' }), 'Sara D.');
    assert.equal(orderCallout({ daily_number: null, guest_label: '  ' }), 'Guest');
  });

  it('maps the row and snapshot once for every KDS consumer', () => {
    const entry = orderBoardEntryFromRow(ORDER);
    assert.equal(entry.shortCode, '47');
    assert.equal(entry.guestName, 'Sara D.');
    assert.deepEqual(entry.lines, [{ name: 'Latte', quantity: 1, options: ['Oat'] }]);
  });
});
