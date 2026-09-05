import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isConstructionTrainingProfile } from '@platform/domain';

import { DEMO_TRAINING_PROFILE, trainingProfileFromBrandConfig } from './training-profile';

describe('operator training profile', () => {
  it('reads industry and template identity from the signed-in brand config', () => {
    const profile = trainingProfileFromBrandConfig({
      identity: { slug: 'northstar-projects' },
      business: { industry: 'Construction and renovation' },
    }, 'Northstar Projects');
    assert.deepEqual(profile, {
      businessName: 'Northstar Projects',
      industry: 'Construction and renovation',
      locale: 'en-US',
      templateKey: 'northstar-projects',
    });
    assert.equal(isConstructionTrainingProfile(profile), true);
  });

  it('never treats a construction-sounding business name as industry data', () => {
    const profile = trainingProfileFromBrandConfig({
      identity: { slug: 'stillpoint-builders' },
      business: { industry: 'Coffee shop' },
    }, 'Stillpoint Builders');
    assert.equal(isConstructionTrainingProfile(profile), false);
  });

  it('uses the explicitly declared Coffee Story demo profile', () => {
    assert.deepEqual(trainingProfileFromBrandConfig(null, null), DEMO_TRAINING_PROFILE);
  });
});
