import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PortalOrder, StaffClient } from '@platform/domain';

import {
  agendaTotalCents,
  orderMinutes,
  ordersOn,
  deltaPercent,
  filterClients,
  formatMoney,
  initials,
  monthGrid,
  openGapMinutes,
  scheduleStrip,
  sourceLabel,
  startOfWeek,
  statusLabel,
} from './workspace';

function makeOrder(
  overrides: Partial<PortalOrder> & { placedAt: string; scheduledFor: string },
): PortalOrder {
  return {
    id: overrides.id ?? 'order',
    status: 'paid',
    summary: 'Spanish Latte (16 oz)',
    lines: [],
    fulfillmentType: 'pickup',
    subtotalCents: 700,
    taxCents: 58,
    tipCents: 0,
    totalCents: 758,
    note: '',
    ...overrides,
  };
}

describe('orderMinutes', () => {
  it('measures the booked span in whole minutes', () => {
    const order = makeOrder({
      placedAt: '2026-07-22T15:00:00.000Z',
      scheduledFor: '2026-07-22T16:15:00.000Z',
    });
    assert.equal(orderMinutes(order), 75);
  });

  it('never reports a negative duration for inverted times', () => {
    const order = makeOrder({
      placedAt: '2026-07-22T16:00:00.000Z',
      scheduledFor: '2026-07-22T15:00:00.000Z',
    });
    assert.equal(orderMinutes(order), 0);
  });
});

describe('openGapMinutes', () => {
  it('reports the daylight between one order and the next', () => {
    const first = makeOrder({ placedAt: '2026-07-22T15:00:00.000Z', scheduledFor: '2026-07-22T17:00:00.000Z' });
    const second = makeOrder({ placedAt: '2026-07-22T17:30:00.000Z', scheduledFor: '2026-07-22T18:30:00.000Z' });
    assert.equal(openGapMinutes(first, second), 30);
  });

  it('is zero for back-to-back and overlapping orders', () => {
    const first = makeOrder({ placedAt: '2026-07-22T15:00:00.000Z', scheduledFor: '2026-07-22T17:00:00.000Z' });
    const touching = makeOrder({ placedAt: '2026-07-22T17:00:00.000Z', scheduledFor: '2026-07-22T18:00:00.000Z' });
    const overlapping = makeOrder({ placedAt: '2026-07-22T16:30:00.000Z', scheduledFor: '2026-07-22T18:00:00.000Z' });
    assert.equal(openGapMinutes(first, touching), 0);
    assert.equal(openGapMinutes(first, overlapping), 0);
  });

  it('is zero for the last order of the day', () => {
    const only = makeOrder({ placedAt: '2026-07-22T15:00:00.000Z', scheduledFor: '2026-07-22T16:00:00.000Z' });
    assert.equal(openGapMinutes(only, undefined), 0);
  });
});

describe('scheduleStrip', () => {
  // The 'recovery' variant is gone with the room-reset buffer an appointment
  // reserved after itself; a counter resets nothing between orders.
  it('falls back to the open gap when no buffer is set', () => {
    const first = makeOrder({ placedAt: '2026-07-22T15:00:00.000Z', scheduledFor: '2026-07-22T16:00:00.000Z' });
    const second = makeOrder({ placedAt: '2026-07-22T16:30:00.000Z', scheduledFor: '2026-07-22T17:30:00.000Z' });
    assert.deepEqual(scheduleStrip(first, second), { kind: 'open', minutes: 30 });
  });

  it('renders nothing when the orders are back to back', () => {
    const first = makeOrder({ placedAt: '2026-07-22T15:00:00.000Z', scheduledFor: '2026-07-22T16:00:00.000Z' });
    const second = makeOrder({ placedAt: '2026-07-22T16:00:00.000Z', scheduledFor: '2026-07-22T17:00:00.000Z' });
    assert.equal(scheduleStrip(first, second), null);
  });
});

describe('formatMoney', () => {
  it('drops cents for whole dollars and keeps them otherwise', () => {
    assert.equal(formatMoney(18500), '$185');
    assert.equal(formatMoney(18550), '$185.50');
    assert.equal(formatMoney(0), '$0');
  });

  it('groups thousands', () => {
    assert.equal(formatMoney(232000), '$2,320');
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    assert.equal(initials('Maria Alvarez'), 'MA');
    assert.equal(initials('Cher'), 'C');
    assert.equal(initials('  jordan  avery  quinn '), 'JA');
  });
});

describe('deltaPercent', () => {
  it('reports the change against the prior period', () => {
    assert.equal(deltaPercent(112, 100), 12);
    assert.equal(deltaPercent(90, 100), -10);
  });

  it('has no answer without a usable baseline', () => {
    assert.equal(deltaPercent(120, 0), null);
    assert.equal(deltaPercent(120, undefined), null);
  });
});

describe('sourceLabel', () => {
  it('titles the online sources and names staff bookings plainly', () => {
    assert.equal(sourceLabel('website'), 'Website');
    assert.equal(sourceLabel('directory'), 'Directory');
    assert.equal(sourceLabel('staff'), 'Added by you');
    assert.equal(sourceLabel(undefined), null);
  });
});

describe('statusLabel', () => {
  it('reads a multi-word status as separate words', () => {
    assert.equal(statusLabel('in_progress'), 'in progress');
    assert.equal(statusLabel('picked_up'), 'picked up');
    assert.equal(statusLabel('paid'), 'paid');
  });
});

describe('ordersOn', () => {
  it('keeps only the chosen day and orders it by start time', () => {
    const day = new Date('2026-07-22T12:00:00.000Z');
    const later = makeOrder({ id: 'later', placedAt: '2026-07-22T20:00:00.000Z', scheduledFor: '2026-07-22T21:00:00.000Z' });
    const earlier = makeOrder({ id: 'earlier', placedAt: '2026-07-22T14:00:00.000Z', scheduledFor: '2026-07-22T15:00:00.000Z' });
    const otherDay = makeOrder({ id: 'other', placedAt: '2026-07-23T14:00:00.000Z', scheduledFor: '2026-07-23T15:00:00.000Z' });
    const result = ordersOn([later, earlier, otherDay], day);
    assert.deepEqual(result.map((order) => order.id), ['earlier', 'later']);
  });
});

describe('agendaTotalCents', () => {
  it('sums the booked value of the day', () => {
    const first = makeOrder({ placedAt: '2026-07-22T15:00:00.000Z', scheduledFor: '2026-07-22T16:00:00.000Z', subtotalCents: 18500 });
    const second = makeOrder({ placedAt: '2026-07-22T17:00:00.000Z', scheduledFor: '2026-07-22T18:00:00.000Z', subtotalCents: 11000 });
    assert.equal(agendaTotalCents([first, second]), 29500);
  });
});

describe('filterClients', () => {
  const clients: StaffClient[] = [
    { id: '1', fullName: 'Maria Alvarez', email: 'maria@email.com', phone: null, completedOrders: 14, tags: ['Regular', 'Matcha'] },
    { id: '2', fullName: 'Tom Becker', email: 'tbecker@email.com', phone: null, completedOrders: 9, tags: ['Cold brew', 'Brew Club'] },
    { id: '3', fullName: 'Dana Kim', email: 'dana.kim@email.com', phone: null, completedOrders: 2, tags: [] },
  ];

  it('matches on name or email, case-insensitively', () => {
    assert.deepEqual(filterClients(clients, 'MARIA', null).map((c) => c.id), ['1']);
    assert.deepEqual(filterClients(clients, 'tbecker', null).map((c) => c.id), ['2']);
  });

  it('narrows by tag and combines both filters', () => {
    assert.deepEqual(filterClients(clients, '', 'Brew Club').map((c) => c.id), ['2']);
    assert.deepEqual(filterClients(clients, 'maria', 'Brew Club').map((c) => c.id), []);
  });

  it('returns everyone when nothing is applied', () => {
    assert.equal(filterClients(clients, '   ', null).length, 3);
  });

  it('treats a client with no tags as unmatched rather than crashing', () => {
    assert.deepEqual(filterClients(clients, '', 'Regular').map((c) => c.id), ['1']);
  });
});

describe('monthGrid', () => {
  it('describes the leading blanks and length of the month', () => {
    // July 2026 starts on a Wednesday and runs 31 days.
    assert.deepEqual(monthGrid(new Date(2026, 6, 15)), { leading: 3, days: 31 });
    // February 2026 starts on a Sunday and runs 28 days.
    assert.deepEqual(monthGrid(new Date(2026, 1, 10)), { leading: 0, days: 28 });
  });
});

describe('startOfWeek', () => {
  it('walks back to Sunday and clears the clock', () => {
    const start = startOfWeek(new Date(2026, 6, 22, 15, 30));
    assert.equal(start.getDay(), 0);
    assert.equal(start.getDate(), 19);
    assert.equal(start.getHours(), 0);
  });
});
