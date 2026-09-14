/**
 * The row -> wire mapping, which is where a brand's numbers are actually
 * decided. Pure, so it is tested without a database; the authorization around
 * it lives in the RPC and is proven by the integration suites.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { orderingSummaryFrom, type OrderingSummaryRow } from './integration-summary';

const BRAND = '00000000-0000-4000-8000-0000000000aa';
const GENERATED = '2026-09-14T18:00:00.000Z';

function row(overrides: Partial<OrderingSummaryRow> = {}): OrderingSummaryRow {
  return {
    brand_slug: 'gate-b', brand_name: 'Gate B',
    location_id: '00000000-0000-4000-8000-0000000000b1',
    location_name: 'Main', location_timezone: 'America/Denver',
    ordering_paused: false, local_day: '2026-09-14',
    orders_today: 2, revenue_cents_today: 2500,
    fee_cents_today: 75, fee_cents_month_to_date: 900,
    square_connected: true, square_needs_reconsent: false,
    menu_published: true, menu_id: '00000000-0000-4000-8000-0000000000c1',
    menu_updated_at: '2026-09-13T10:00:00.000Z',
    ...overrides,
  };
}

describe('orderingSummaryFrom', () => {
  it('sums every location into the totals', () => {
    const summary = orderingSummaryFrom(BRAND, [
      row(),
      row({
        location_id: '00000000-0000-4000-8000-0000000000b2', location_name: 'Second',
        orders_today: 3, revenue_cents_today: 4000, fee_cents_today: 120,
        fee_cents_month_to_date: 1_500,
      }),
    ], GENERATED);
    assert.deepEqual(summary.totals, {
      ordersToday: 5, revenueCentsToday: 6_500, feeCentsToday: 195, feeCentsMonthToDate: 2_400,
    });
    assert.equal(summary.brand.slug, 'gate-b');
    assert.equal(summary.generatedAt, GENERATED);
  });

  /**
   * Two locations in different timezones have different business dates, and
   * the day has to travel per location or a caller renders one shop's "today"
   * over another's.
   */
  it('keeps each location on its own business date', () => {
    const summary = orderingSummaryFrom(BRAND, [
      row({ local_day: '2026-09-14', location_timezone: 'America/Denver' }),
      row({
        location_id: '00000000-0000-4000-8000-0000000000b3', location_name: 'Tokyo',
        location_timezone: 'Asia/Tokyo', local_day: '2026-09-15',
      }),
    ], GENERATED);
    assert.deepEqual(summary.locations.map((one) => one.day), ['2026-09-14', '2026-09-15']);
  });

  /**
   * An enrolled brand that has not opened a location yet is a real answer, not
   * an error. The caller separates "no locations" from "could not read" by the
   * status code, so the body must stay well-formed rather than null.
   */
  it('answers a brand with no locations with zeroes, not null', () => {
    const summary = orderingSummaryFrom(BRAND, [], GENERATED);
    assert.deepEqual(summary.locations, []);
    assert.deepEqual(summary.totals, {
      ordersToday: 0, revenueCentsToday: 0, feeCentsToday: 0, feeCentsMonthToDate: 0,
    });
    assert.equal(summary.menu.published, false);
    assert.equal(summary.menu.publishedMenuId, null);
    assert.equal(summary.brand.id, BRAND);
  });

  it('carries the square reconsent flag through per location', () => {
    const summary = orderingSummaryFrom(BRAND, [
      row({ square_connected: true, square_needs_reconsent: true }),
    ], GENERATED);
    assert.deepEqual(summary.locations[0]?.square, { connected: true, needsReconsent: true });
  });
});
