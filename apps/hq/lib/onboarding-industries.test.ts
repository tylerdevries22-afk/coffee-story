import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ONBOARDING_INDUSTRIES } from './onboarding-industries';

describe('onboarding industries', () => {
  it('exposes hospitality and construction factory blueprints', () => {
    assert.deepEqual(ONBOARDING_INDUSTRIES.map((industry) => industry.key), [
      'coffee-shop',
      'construction',
    ]);
  });
});
