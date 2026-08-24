import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { staffRevenueMetrics } from './revenue';

describe('staff revenue status contract', () => {
  it('excludes unpaid and reversed orders while retaining the paid lifecycle', () => {
    assert.deepEqual(staffRevenueMetrics([
      { status: 'created', total_cents: 9_000 },
      { status: 'paid', total_cents: 100 },
      { status: 'in_progress', total_cents: 200 },
      { status: 'ready', total_cents: 300 },
      { status: 'picked_up', total_cents: 400 },
      { status: 'cancelled', total_cents: 8_000 },
      { status: 'refunded', total_cents: 7_000 },
      { status: 'future_unpaid_state', total_cents: 6_000 },
    ]), { revenueCents: 1_000, orderCount: 4 });
  });
});
