import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  feeOverridesEmptyReason,
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
    assert.equal(parseLocationFeeOverrides({
      feeBps: '9000', feeBpsTier2: '9000', tierThresholdCents: '0',
    }).ok, true);
  });

  it('rejects fractions, negatives, and rates above one hundred percent', () => {
    for (const input of [
      { feeBps: '1.5', feeBpsTier2: '', tierThresholdCents: '' },
      { feeBps: '-1', feeBpsTier2: '', tierThresholdCents: '' },
      { feeBps: '9001', feeBpsTier2: '', tierThresholdCents: '' },
    ]) assert.equal(parseLocationFeeOverrides(input).ok, false);
  });

  it('rejects a volume tier priced above the base rate', () => {
    // Rule 3 is "the rate drops above the threshold" -- swapped fields would
    // silently make every payment above the threshold cost MORE.
    assert.equal(parseLocationFeeOverrides({
      feeBps: '150', feeBpsTier2: '300', tierThresholdCents: '',
    }).ok, false);
  });

  it('accepts a volume tier equal to the base rate', () => {
    assert.deepEqual(parseLocationFeeOverrides({
      feeBps: '300', feeBpsTier2: '300', tierThresholdCents: '',
    }), { ok: true, draft: { feeBps: 300, feeBpsTier2: 300, tierThresholdCents: null } });
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
    const tooHigh = { async rpc() { return { data: {
      brand: { feeBps: 9001, feeBpsTier2: 100, tierThresholdCents: 10 }, locations: [],
    }, error: null }; } };
    assert.equal(await readPlatformFeeTerms(tooHigh as never, 'actor-1', 'brand-1'), null);
  });
});

describe('feeOverridesEmptyReason', () => {
  it('says nothing when there are locations to edit', () => {
    for (const configured of [true, false]) {
      assert.equal(feeOverridesEmptyReason({ locations: 2, configured }), null);
    }
  });

  it('blames the organization only when a live deployment answered', () => {
    assert.equal(
      feeOverridesEmptyReason({ locations: 0, configured: true }),
      'No locations are available in this organization.',
    );
  });

  /**
   * The unconfigured console reads its fee TABLE from demo fixtures, which
   * name two locations, while loadFeeTerms returns none -- so the old single
   * sentence reported a tenant with no locations directly above a table of
   * two. The demo sentence has to say which half is fixture.
   */
  it('says the console has no deployment behind it, and that the figures are fixtures', () => {
    const reason = feeOverridesEmptyReason({ locations: 0, configured: false });
    assert.match(reason ?? '', /no live deployment behind it/);
    assert.match(reason ?? '', /demo fixtures/);
    assert.doesNotMatch(reason ?? '', /No locations are available in this organization/);
  });
});
