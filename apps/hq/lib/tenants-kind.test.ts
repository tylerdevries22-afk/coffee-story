/**
 * No franchise tenant in the demo registry may be labelled the platform
 * operator.
 *
 * The workspace switcher renders `kind: 'operator'` as an "Operator" badge --
 * the platform's own account, not a tenant. Stillpoint Builders carried it,
 * so the demo showed a construction franchisee as the operator of the
 * platform. Configured deployments assign every brands row `kind: 'brand'`
 * (workspace-scope.ts), so this was demo-only and exactly the kind of thing a
 * pitch surfaces.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TENANT_ORGS } from './tenants';

describe('demo tenant registry kinds', () => {
  it('labels every registered tenant a brand', () => {
    const operators = TENANT_ORGS.filter((org) => org.kind === 'operator').map((org) => org.slug);
    assert.deepEqual(operators, [],
      `${operators.join(', ')} carries kind 'operator' -- a tenant labelled as the platform`);
  });

  it('still registers the construction franchise', () => {
    assert.ok(TENANT_ORGS.some((org) => org.slug === 'stillpoint-builders' && org.kind === 'brand'));
  });
});
