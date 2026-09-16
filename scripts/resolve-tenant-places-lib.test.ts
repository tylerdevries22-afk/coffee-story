import assert from 'node:assert/strict';
import test from 'node:test';

import { tenantBrandPath } from './resolve-tenant-places-lib';

test('tenantBrandPath keeps a valid tenant under the tenant root', () => {
  assert.equal(
    tenantBrandPath('/repo', 'summit-ridge-hotels'),
    '/repo/tenants/summit-ridge-hotels/brand.json',
  );
});

test('tenantBrandPath rejects traversal and non-canonical tenant names', () => {
  for (const slug of ['../../outside', '../tenant', '/absolute', 'Uppercase', 'two--dashes']) {
    assert.throws(() => tenantBrandPath('/repo', slug), /Invalid tenant slug/);
  }
});
