import assert from 'node:assert/strict';
import test from 'node:test';

import { mayMutateSelectedOrganization } from './workspace-mutation';

test('ordinary mutations stay on the session home organization', () => {
  assert.equal(mayMutateSelectedOrganization('brand-1', 'brand-1'), true);
  assert.equal(mayMutateSelectedOrganization('brand-1', 'brand-2'), false);
});
