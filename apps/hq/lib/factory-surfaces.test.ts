import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { factorySurfacePlan } from './factory-surfaces';

describe('factorySurfacePlan', () => {
  it('keeps the coffee blueprint on all five applications', () => {
    const plan = factorySurfacePlan('coffee-shop');
    assert.deepEqual(plan.all, ['hq', 'display', 'customer', 'operator', 'kiosk']);
  });

  it('keeps the construction blueprint on all five tenant-driven applications', () => {
    const plan = factorySurfacePlan('construction');
    assert.deepEqual(plan.all, ['hq', 'display', 'customer', 'operator', 'kiosk']);
    assert.deepEqual(plan.web, ['display', 'customer', 'operator', 'kiosk']);
    assert.deepEqual(plan.native, ['customer', 'operator', 'kiosk']);
  });

  it('accepts explicit guest flags and normalizes ordering', () => {
    const plan = factorySurfacePlan('custom', {
      applicationSurfaces: { guest: true, kiosk: true, operator: false },
    });
    assert.deepEqual(plan.all, ['hq', 'customer', 'kiosk']);
  });

  it('rejects unknown industries and unsupported surfaces', () => {
    assert.throws(() => factorySurfacePlan('custom'), /must declare/);
    assert.throws(
      () => factorySurfacePlan('custom', { surfaces: ['customer', 'admin'] }),
      /unsupported/,
    );
    assert.throws(
      () => factorySurfacePlan('custom', { surfaces: ['operator', 'operator'] }),
      /unique/,
    );
  });
});
