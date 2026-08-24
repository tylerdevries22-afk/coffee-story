import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { OrderRow } from '@platform/schema';

import { boardOrderFromRow, shortCodeOf, upsertBoardOrder } from './live-board';

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

describe('shortCodeOf', () => {
  it('is stable per id and letter+two-digits shaped', () => {
    const code = shortCodeOf(ROW.id);
    assert.equal(code, shortCodeOf(ROW.id));
    assert.match(code, /^[A-Z]\d{2}$/);
    assert.notEqual(code, shortCodeOf('another-id'));
  });
});

describe('boardOrderFromRow', () => {
  it('maps the row and its snapshot lines', () => {
    const order = boardOrderFromRow(ROW, 'Yusuf');
    assert.equal(order.guestName, 'Yusuf');
    assert.equal(order.status, 'paid');
    assert.equal(order.totalCents, 1395);
    assert.deepEqual(order.lines, [{ name: 'Latte', quantity: 2, options: ['16 oz', 'Oat Milk'] }]);
    assert.equal(order.note, 'extra hot');
  });

  it('survives a snapshot with no lines', () => {
    const order = boardOrderFromRow({ ...ROW, totals: {} }, '');
    assert.deepEqual(order.lines, []);
  });
});

describe('upsertBoardOrder', () => {
  it('replaces by id and keeps a resolved guest name over a blank one', () => {
    const first = boardOrderFromRow(ROW, 'Yusuf');
    const updated = boardOrderFromRow({ ...ROW, status: 'in_progress' }, '');
    const next = upsertBoardOrder([first], updated);
    assert.equal(next.length, 1);
    assert.equal(next[0]!.status, 'in_progress');
    assert.equal(next[0]!.guestName, 'Yusuf');
  });

  it('appends an unknown id', () => {
    const first = boardOrderFromRow(ROW, 'Yusuf');
    const other = boardOrderFromRow({ ...ROW, id: 'ffffffff-0000-4000-8000-000000000002' }, 'Maya');
    assert.equal(upsertBoardOrder([first], other).length, 2);
  });
});
