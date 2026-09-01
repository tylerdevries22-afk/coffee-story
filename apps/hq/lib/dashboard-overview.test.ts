import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { KpiDay } from './demo-data';
import { buildChannelMix, coverageDays, formatKpiRange } from './dashboard-overview';

function kpi(day: string): KpiDay {
  return {
    day, locationId: 'loc-1', locationName: 'Union Station', ordersCount: 2,
    revenueCents: 2_000, aovCents: 1_000, inAppShare: 0.5,
    loyaltyRedemptionRate: 0.25,
    channelRevenueCents: { app: 800, web: 200, kiosk: 0, pos: 1_000 },
  };
}

describe('buildChannelMix', () => {
  it('ranks channels and calculates their part of the whole', () => {
    const rows = buildChannelMix({ app: 300, web: 100, kiosk: 200, pos: 400 });
    assert.deepEqual(rows.map((row) => row.key), ['pos', 'app', 'kiosk', 'web']);
    assert.equal(rows[0]?.share, 0.4);
  });

  it('returns zero shares for an empty reporting period', () => {
    assert.ok(buildChannelMix({ app: 0, web: 0, kiosk: 0, pos: 0 })
      .every((row) => row.share === 0));
  });
});

describe('overview reporting range', () => {
  it('formats the complete distinct-day range in UTC', () => {
    const days = [kpi('2026-08-25'), kpi('2026-08-31'), kpi('2026-08-25')];
    assert.equal(formatKpiRange(days), 'Aug 25 – Aug 31, 2026');
    assert.equal(coverageDays(days), 2);
    assert.equal(formatKpiRange([kpi('2026-08-25')]), 'Aug 25, 2026');
    assert.equal(
      formatKpiRange([kpi('2026-12-31'), kpi('2027-01-01')]),
      'Dec 31, 2026 – Jan 1, 2027',
    );
  });

  it('handles missing data explicitly', () => {
    assert.equal(formatKpiRange([]), 'No reporting period');
    assert.equal(coverageDays([]), 0);
  });
});
