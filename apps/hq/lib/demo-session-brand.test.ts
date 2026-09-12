import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveDemoSessionBrandName } from './demo-data';

describe('resolveDemoSessionBrandName', () => {
  it('returns Coffee Story only for explicit coffee-story slug', () => {
    assert.equal(
      resolveDemoSessionBrandName({ NODE_ENV: 'test', EXPO_PUBLIC_TENANT: 'coffee-story' }),
      'Coffee Story',
    );
  });

  it('fails closed in production when slug is unset', () => {
    assert.equal(resolveDemoSessionBrandName({ NODE_ENV: 'production' }), 'HQ');
    assert.equal(
      resolveDemoSessionBrandName({ NODE_ENV: 'production', EXPO_PUBLIC_TENANT: '  ' }),
      'HQ',
    );
  });

  it('does not advertise Coffee Story for other explicit tenants', () => {
    assert.equal(
      resolveDemoSessionBrandName({ NODE_ENV: 'test', EXPO_PUBLIC_TENANT: 'stillpoint-builders' }),
      'HQ',
    );
    assert.equal(resolveDemoSessionBrandName({ NODE_ENV: 'test', TENANT: 'demo-roastery' }), 'HQ');
  });
});
