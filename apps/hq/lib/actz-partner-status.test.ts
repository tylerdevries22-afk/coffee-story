import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { actzPartnerStatusFrom } from './actz-partner-status';

describe('actzPartnerStatusFrom', () => {
  it('maps stages without implying go-live writes', () => {
    assert.equal(
      actzPartnerStatusFrom({
        brandId: 'b', slug: 's', name: 'N', actzProviderOrgId: 'o',
        brandStatus: 'active', runStage: null,
      }).status,
      'sandbox',
    );
    assert.equal(
      actzPartnerStatusFrom({
        brandId: 'b', slug: 's', name: 'N', actzProviderOrgId: 'o',
        brandStatus: 'active', runStage: 'ready',
      }).status,
      'awaiting_go_live',
    );
    assert.equal(
      actzPartnerStatusFrom({
        brandId: 'b', slug: 's', name: 'N', actzProviderOrgId: 'o',
        brandStatus: 'active', runStage: 'active',
      }).status,
      'live',
    );
  });
});
