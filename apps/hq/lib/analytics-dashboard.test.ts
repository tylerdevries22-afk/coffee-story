import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEMO_CAMPAIGNS,
  DEMO_CUSTOMERS,
  DEMO_DROPS,
  DEMO_KPIS,
} from './demo-data';
import { buildAnalyticsDashboard, type AnalyticsViewKey } from './analytics-dashboard';

const input = {
  kpis: DEMO_KPIS,
  drops: DEMO_DROPS,
  campaigns: DEMO_CAMPAIGNS,
  customers: DEMO_CUSTOMERS,
};

describe('buildAnalyticsDashboard', () => {
  it('builds every supported view with a stable title and accessible tables', () => {
    const views: AnalyticsViewKey[] = [
      'overview',
      'apps',
      'commerce',
      'operations',
      'training',
      'growth',
      'reliability',
    ];

    for (const view of views) {
      const model = buildAnalyticsDashboard(view, input);
      assert.ok(model.title.length > 0);
      assert.ok(model.metrics.length >= 4);
      assert.ok(model.tables.length > 0);
      assert.ok(model.tables.every((table) => table.columns.length > 1));
    }
  });

  it('uses authoritative commerce records for overview totals', () => {
    const model = buildAnalyticsDashboard('overview', input);
    assert.equal(model.metrics[0]?.label, 'Revenue');
    assert.notEqual(model.metrics[0]?.value, 'Collecting');
    assert.equal(model.breakdown?.rows.length, 4);
  });

  it('does not fabricate unavailable behavioral or reliability values', () => {
    const apps = buildAnalyticsDashboard('apps', input);
    const reliability = buildAnalyticsDashboard('reliability', input);
    assert.ok(apps.metrics.every((metric) => metric.state === 'collecting'));
    assert.ok(reliability.metrics.every((metric) => metric.value === 'Collecting'));
  });

  it('returns explicit empty states when tenant data is absent', () => {
    const model = buildAnalyticsDashboard('commerce', {
      kpis: [],
      drops: [],
      campaigns: [],
      customers: [],
    });
    assert.equal(model.metrics[0]?.value, '$0.00');
    assert.equal(model.tables[1]?.rows.length, 0);
    assert.match(model.tables[1]?.emptyMessage ?? '', /No drops/);
  });

  it('handles campaigns with no sends without an invalid percentage', () => {
    const [campaign] = DEMO_CAMPAIGNS;
    assert.ok(campaign);
    const model = buildAnalyticsDashboard('growth', {
      ...input,
      campaigns: [{ ...campaign, sent: 0, redeemed: 0 }],
    });
    assert.equal(model.metrics.find((metric) => metric.label === 'Redemption rate')?.value, '—');
  });
});
