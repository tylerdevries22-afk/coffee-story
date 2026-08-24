import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  campaignSummariesOf,
  customerSummariesOf,
  dropSummariesOf,
  feeRowsOf,
  kpiDaysOf,
  locationSummariesOf,
  menuSummariesOf,
} from './live-mappers';

describe('kpiDaysOf', () => {
  it('maps metric rows and coerces PostgREST numerics', () => {
    const days = kpiDaysOf(
      [{ location_id: 'l1', day: '2026-08-22', orders_count: '42', revenue_cents: '47700', aov_cents: 1135, in_app_share: '0.562', loyalty_redemption_rate: 0.216, revenue_by_channel: { app: '12000', web: 3000, kiosk: 6000, pos: 26700 } }],
      new Map([['l1', 'Havana St']]),
    );
    assert.equal(days[0]!.locationName, 'Havana St');
    assert.equal(days[0]!.ordersCount, 42);
    assert.equal(days[0]!.inAppShare, 0.562);
    assert.deepEqual(days[0]!.channelRevenueCents, { app: 12000, web: 3000, kiosk: 6000, pos: 26700 });
  });
});

describe('dropSummariesOf', () => {
  it('joins performance and item names, zero-fills a drop with no orders', () => {
    const drops = dropSummariesOf(
      [
        { id: 'd1', item_id: 'i1', starts_at: 'a', ends_at: 'b', status: 'live' },
        { id: 'd2', item_id: 'i2', starts_at: 'c', ends_at: 'd', status: 'scheduled' },
      ],
      [{ drop_id: 'd1', orders_count: 212, revenue_cents: '142900' }],
      new Map([['i1', 'Honey Lavender Latte']]),
    );
    assert.equal(drops[0]!.itemName, 'Honey Lavender Latte');
    assert.equal(drops[0]!.revenueCents, 142_900);
    assert.equal(drops[1]!.ordersCount, 0);
  });
});

describe('menuSummariesOf', () => {
  it('shows the cheapest size as the from-price and counts option groups', () => {
    const menu = menuSummariesOf(
      [{
        id: 'm1', name: 'Latte', category_id: 'c1', base_price_cents: 400,
        sizes: [{ slug: '12', price_cents: 400 }, { slug: '16', price_cents: 500 }],
        modifiers: [{}, {}, {}], is_86d: false, image_url: null,
      }],
      new Map([['c1', 'Coffee & Espresso']]),
    );
    assert.equal(menu[0]!.priceCents, 400);
    assert.equal(menu[0]!.modifierGroups, 3);
    assert.equal(menu[0]!.category, 'Coffee & Espresso');
  });
});

describe('locationSummariesOf', () => {
  it('reads the address city line, the Square link, and the hours coverage', () => {
    const rows = locationSummariesOf([{
      id: 'l1', name: 'Main', address: { city: 'Aurora', region: 'CO' }, timezone: 'America/Denver',
      square_connection_id: null, ordering_paused: true, hours: { mon: [{ open: '08:00', close: '22:00' }] },
    }]);
    assert.equal(rows[0]!.city, 'Aurora, CO');
    assert.equal(rows[0]!.squareConnected, false);
    assert.equal(rows[0]!.orderingPaused, true);
    assert.equal(rows[0]!.hours, '1 days configured');
  });
});

describe('campaignSummariesOf', () => {
  it('labels the audience and reads stats defensively', () => {
    const rows = campaignSummariesOf([
      { id: 'c1', name: 'A', channel: 'push', status: 'sent', scheduled_at: null, audience: { kind: 'lapsed', days: 30 }, stats: { delivered: 12 } },
      { id: 'c2', name: 'B', channel: 'sms', status: 'draft', scheduled_at: null, audience: {}, stats: null },
    ]);
    assert.equal(rows[0]!.audience, 'Lapsed 30 days');
    assert.equal(rows[0]!.sent, 12);
    assert.equal(rows[1]!.audience, 'Everyone');
    assert.equal(rows[1]!.sent, 0);
  });
});

describe('customerSummariesOf', () => {
  it('counts only collected revenue in lifetime spend and last order', () => {
    const rows = customerSummariesOf(
      [{ id: 'g1', full_name: 'Maya', phone: null }],
      [{ customer_id: 'g1', points_balance: '340' }],
      [
        { customer_id: 'g1', total_cents: 1200, status: 'picked_up', created_at: '2026-08-20T10:00:00Z' },
        { customer_id: 'g1', total_cents: 900, status: 'paid', created_at: '2026-08-22T10:00:00Z' },
        { customer_id: 'g1', total_cents: 400, status: 'in_progress', created_at: '2026-08-23T10:00:00Z' },
        { customer_id: 'g1', total_cents: 300, status: 'ready', created_at: '2026-08-24T10:00:00Z' },
        { customer_id: 'g1', total_cents: 7000, status: 'created', created_at: '2026-08-25T10:00:00Z' },
        { customer_id: 'g1', total_cents: 5000, status: 'cancelled', created_at: '2026-08-23T10:00:00Z' },
        { customer_id: 'g1', total_cents: 6000, status: 'refunded', created_at: '2026-08-26T10:00:00Z' },
        { customer_id: 'g1', total_cents: 8000, status: 'future_unpaid_state', created_at: '2026-08-27T10:00:00Z' },
      ],
    );
    assert.equal(rows[0]!.points, 340);
    assert.equal(rows[0]!.lifetimeCents, 2800);
    assert.equal(rows[0]!.lastOrderAt, '2026-08-24T10:00:00Z');
    assert.equal(rows[0]!.phone, '—');
  });
});

describe('feeRowsOf', () => {
  it('groups by calendar month x location, newest month first', () => {
    const rows = feeRowsOf(
      [
        { location_id: 'l1', gross_cents: 1000, fee_cents: 30, created_at: '2026-08-02T10:00:00Z' },
        { location_id: 'l1', gross_cents: 2000, fee_cents: 60, created_at: '2026-08-15T10:00:00Z' },
        { location_id: 'l1', gross_cents: 500, fee_cents: 15, created_at: '2026-07-30T10:00:00Z' },
      ],
      new Map([['l1', 'Main']]),
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], { month: '2026-08', locationId: 'l1', locationName: 'Main', grossCents: 3000, feeCents: 90, payments: 2 });
    assert.equal(rows[1]!.month, '2026-07');
  });
});
