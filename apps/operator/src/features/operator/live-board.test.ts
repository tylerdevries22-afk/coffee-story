import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { orderBoardEntryFromRow } from '@platform/data';
import type { OrderRow } from '@platform/schema';

import { upsertBoardOrder } from './live-board';

const ROW: OrderRow = {
  id: '5d9a4c7e-0000-4000-8000-000000000001',
  brand_id: 'b',
  location_id: 'l',
  customer_id: 'c',
  status: 'paid',
  fulfillment_type: 'pickup',
  channel: 'app',
  device_id: null,
  scheduled_for: null,
  totals: { lines: [{ name: 'Latte', quantity: 2, unit_price_cents: 600, options: ['16 oz', 'Oat Milk'] }] },
  subtotal_cents: 1200,
  tax_cents: 95,
  tip_cents: 100,
  total_cents: 1395,
  loyalty_redeemed_points: 0,
  stored_value_applied_cents: 0,
  note: 'extra hot',
  service_date: '2026-08-22',
  daily_number: 47,
  guest_label: 'Sara D.',
  arrived_at: null,
  square_order_id: null,
  square_payment_id: null,
  created_at: '2026-08-22T10:00:00Z',
  updated_at: '2026-08-22T10:00:00Z',
};

describe('upsertBoardOrder', () => {
  it('replaces by id with the authoritative shared mapping', () => {
    const first = orderBoardEntryFromRow({ ...ROW, guest_label: 'Yusuf' });
    const updated = orderBoardEntryFromRow({ ...ROW, status: 'in_progress', guest_label: '' });
    const next = upsertBoardOrder([first], updated);
    assert.equal(next.length, 1);
    assert.equal(next[0]!.status, 'in_progress');
    assert.equal(next[0]!.guestName, 'Guest');
  });

  it('appends an unknown id', () => {
    const first = orderBoardEntryFromRow({ ...ROW, guest_label: 'Yusuf' });
    const other = orderBoardEntryFromRow({ ...ROW, id: 'ffffffff-0000-4000-8000-000000000002', guest_label: 'Maya' });
    assert.equal(upsertBoardOrder([first], other).length, 2);
  });
});
