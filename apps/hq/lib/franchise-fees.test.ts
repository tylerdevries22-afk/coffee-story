import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  parseLocationFeeOverrides,
  readPlatformFeeTerms,
  updateLocationFeeOverrides,
} from './franchise-fees';

describe('parseLocationFeeOverrides', () => {
  it('accepts explicit zeroes and nullable inherited terms', () => {
    assert.deepEqual(parseLocationFeeOverrides({
      feeBps: '0', feeBpsTier2: '', tierThresholdCents: '2000000',
    }), {
      ok: true,
      draft: { feeBps: 0, feeBpsTier2: null, tierThresholdCents: 2_000_000 },
    });
  });

  it('rejects fractions, negatives, and rates above one hundred percent', () => {
    for (const input of [
      { feeBps: '1.5', feeBpsTier2: '', tierThresholdCents: '' },
      { feeBps: '-1', feeBpsTier2: '', tierThresholdCents: '' },
      { feeBps: '10001', feeBpsTier2: '', tierThresholdCents: '' },
    ]) assert.equal(parseLocationFeeOverrides(input).ok, false);
  });
});

describe('updateLocationFeeOverrides', () => {
  it('passes actor and both tenant keys to the guarded RPC and proves the row', async () => {
    let args: Record<string, unknown> | null = null;
    const db = { async rpc(_name: string, value: Record<string, unknown>) {
      args = value;
      return { data: 'location-1', error: null };
    } };
    const updated = await updateLocationFeeOverrides(db as never, {
      actorId: 'actor-1', brandId: 'brand-1', locationId: 'location-1',
      auditCorrelationId: 'audit-1',
      feeBps: 200, feeBpsTier2: null, tierThresholdCents: 2_500_000,
    });
    assert.equal(updated, true);
    assert.deepEqual(args, {
      p_actor_id: 'actor-1', p_brand_id: 'brand-1', p_fee_bps: 200,
      p_correlation_id: 'audit-1',
      p_fee_bps_tier2: null, p_location_id: 'location-1',
      p_tier_threshold_cents: 2_500_000,
    });
  });

  it('fails closed when the RPC returns no matching row', async () => {
    const db = { async rpc() { return { data: null, error: null }; } };
    assert.equal(await updateLocationFeeOverrides(db as never, {
      actorId: 'actor-1', brandId: 'brand-1', locationId: 'location-2',
      auditCorrelationId: 'audit-2',
      feeBps: null, feeBpsTier2: null, tierThresholdCents: null,
    }), false);
  });
});

describe('readPlatformFeeTerms', () => {
  it('passes actor and brand to the guarded reader and validates its result', async () => {
    let args: Record<string, unknown> | null = null;
    const db = { async rpc(_name: string, value: Record<string, unknown>) {
      args = value;
      return { data: {
        brand: { feeBps: 300, feeBpsTier2: 150, tierThresholdCents: 2_000_000 },
        locations: [{ id: 'location-1', name: 'Main', feeBps: null,
          feeBpsTier2: 100, tierThresholdCents: null }],
      }, error: null };
    } };
    const terms = await readPlatformFeeTerms(db as never, 'actor-1', 'brand-1');
    assert.deepEqual(args, { p_actor_id: 'actor-1', p_brand_id: 'brand-1' });
    assert.equal(terms?.locations[0]?.feeBpsTier2, 100);
  });

  it('fails closed on malformed commercial terms', async () => {
    const db = { async rpc() {
      return { data: { brand: { feeBps: -1 }, locations: [] }, error: null };
    } };
    assert.equal(await readPlatformFeeTerms(db as never, 'actor-1', 'brand-1'), null);
  });
});
