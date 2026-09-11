import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isSetupConsolePath } from './auth';

describe('isSetupConsolePath', () => {
  it('allows the new-shop wizard only', () => {
    assert.equal(isSetupConsolePath('/organizations/new'), true);
    assert.equal(isSetupConsolePath('/'), false);
    assert.equal(isSetupConsolePath('/onboarding'), false);
    assert.equal(isSetupConsolePath('/login'), false);
  });
});
