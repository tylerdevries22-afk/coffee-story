import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { usesLaunchFixtures } from './demo-fixture-scope';

describe('usesLaunchFixtures', () => {
  it('uses launch fixtures for the default or launch organization', () => {
    assert.equal(usesLaunchFixtures(null, 'launch'), true);
    assert.equal(usesLaunchFixtures('launch', 'launch'), true);
  });

  it('keeps launch fixtures out of every other organization', () => {
    assert.equal(usesLaunchFixtures('neutral-demo', 'launch'), false);
    assert.equal(usesLaunchFixtures('unknown-cookie', 'launch'), false);
  });
});
