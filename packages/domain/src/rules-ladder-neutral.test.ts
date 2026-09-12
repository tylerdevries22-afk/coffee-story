/**
 * The shipped reward ladder is the fallback for a tenant that wrote none, so
 * it must be true for every industry at once.
 *
 * It said "priority pickup". A consultancy or a studio that enables loyalty
 * and never authors a ladder would have promised a counter it does not have --
 * the same leak as a construction franchise being shown "kitchen", one layer
 * down. This pins the fallback to naming no product, venue or fulfillment
 * model, with the same vocabulary the home-screen industry packs are held to.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { REWARD_TIERS } from './rules';

const FULFILLMENT_OR_VENUE = /pickup|delivery|counter|table|kitchen|dine|dining/i;
const HOSPITALITY_PRODUCT = /coffee|latte|espresso|boba|drink|cup\b|brew|barista|menu\b|dish/i;

describe('shipped reward ladder is industry-neutral', () => {
  it('names no fulfillment model or venue in any rung', () => {
    for (const tier of REWARD_TIERS) {
      const text = [tier.name, tier.description, ...tier.perks].join(' | ');
      assert.doesNotMatch(text, FULFILLMENT_OR_VENUE,
        `rung "${tier.name}" promises a fulfillment model or venue the fallback cannot assume: ${text}`);
    }
  });

  it('names no hospitality product in any rung', () => {
    for (const tier of REWARD_TIERS) {
      const text = [tier.name, tier.description, ...tier.perks].join(' | ');
      assert.doesNotMatch(text, HOSPITALITY_PRODUCT,
        `rung "${tier.name}" names a product the fallback cannot assume: ${text}`);
    }
  });

  /** A ladder with no rungs would pass both checks by saying nothing. */
  it('still ships a full ladder', () => {
    assert.ok(REWARD_TIERS.length >= 3);
    assert.ok(REWARD_TIERS.every((tier) => tier.perks.length > 0));
  });
});
