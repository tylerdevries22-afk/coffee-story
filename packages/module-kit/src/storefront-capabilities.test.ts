import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MODULE_REGISTRY, LEGACY_FLAG_MODULE_MAP } from './registry';
import {
  STOREFRONT_CAPABILITIES,
  STOREFRONT_CAPABILITY_MODULE,
  storefrontCapabilitiesOf,
} from './storefront-capabilities';

describe('the storefront capability map', () => {
  it('names only modules the anonymous projection may publish', () => {
    // The projection filters on `'customer' = any (registry.surfaces)`. A flag
    // pointing at a module outside that set would resolve false for every
    // tenant forever, which reads as "switched off" rather than "never asked".
    const customerFacing = new Set(
      MODULE_REGISTRY
        .filter((definition) => definition.surfaces.includes('customer'))
        .map((definition) => definition.key),
    );
    for (const capability of STOREFRONT_CAPABILITIES) {
      assert.ok(customerFacing.has(STOREFRONT_CAPABILITY_MODULE[capability]),
        `${capability} points at a module the storefront can never be told about`);
    }
  });

  it('agrees with the legacy flag map it narrows', () => {
    for (const capability of STOREFRONT_CAPABILITIES) {
      assert.equal(STOREFRONT_CAPABILITY_MODULE[capability], LEGACY_FLAG_MODULE_MAP[capability],
        `${capability} resolves to a different module than the backfill installed`);
    }
  });

  it('withholds operations, which is not a storefront fact', () => {
    assert.ok(!(STOREFRONT_CAPABILITIES as readonly string[]).includes('operations'),
      'staff scheduling must not be resolvable from a guest surface');
  });
});

describe('storefrontCapabilitiesOf', () => {
  it('is total: every flag answers, and an absent module answers false', () => {
    const resolved = storefrontCapabilitiesOf(['growth-drops']);
    assert.deepEqual(resolved, {
      drops: true,
      catering: false,
      delivery: false,
      stored_value: false,
      referrals: false,
    });
  });

  it('ignores a module key this binary does not know', () => {
    // A newer server naming a module this build predates is not a reason to
    // discard the answer; it is a reason to branch on nothing.
    const resolved = storefrontCapabilitiesOf(['growth-drops', 'a-module-from-the-future']);
    assert.equal(resolved.drops, true);
    assert.equal(resolved.catering, false);
  });

  it('resolves nothing from an empty installation', () => {
    for (const value of Object.values(storefrontCapabilitiesOf([]))) assert.equal(value, false);
  });
});
