import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  competencyAwardActionId,
  matchesTrainingAttempt,
  trainingCompetencyGrantPlan,
} from './training-competencies';

describe('trainingCompetencyGrantPlan', () => {
  it('grants unique configured keys for the configured validity period', () => {
    assert.deepEqual(trainingCompetencyGrantPlan({
      grantsCompetencyKeys: ['restroom-sanitation', 'restroom-sanitation'],
      competencyValidityDays: 180,
    }, true, new Date('2026-08-27T00:00:00.000Z')), {
      keys: ['restroom-sanitation'],
      expiresAt: '2027-02-23T00:00:00.000Z',
    });
  });

  it('uses the annual default and rejects failed or malformed grants', () => {
    assert.equal(trainingCompetencyGrantPlan({ grantsCompetencyKeys: ['restroom-sanitation'] }, false), null);
    assert.equal(trainingCompetencyGrantPlan({ grantsCompetencyKeys: ['Not Safe'] }, true), null);
    const plan = trainingCompetencyGrantPlan(
      { grantsCompetencyKeys: ['restroom-sanitation'] },
      true,
      new Date('2026-01-01T00:00:00.000Z'),
    );
    assert.equal(plan?.expiresAt, '2027-01-01T00:00:00.000Z');
  });
});

describe('competencyAwardActionId', () => {
  it('is a deterministic UUID scoped to both attempt and competency', () => {
    const first = competencyAwardActionId('11111111-1111-4111-8111-111111111111', 'restroom-sanitation');
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(first, competencyAwardActionId('11111111-1111-4111-8111-111111111111', 'restroom-sanitation'));
    assert.notEqual(first, competencyAwardActionId('11111111-1111-4111-8111-111111111111', 'food-safety'));
  });
});

describe('matchesTrainingAttempt', () => {
  const attempt = {
    release_id: 'release-a',
    track_slug: 'safety',
    lesson_slug: 'equipment-safety',
    answers: [1, 0],
  };

  it('accepts only an exact replay of the original lesson attempt', () => {
    assert.equal(matchesTrainingAttempt(attempt, { ...attempt, answers: [...attempt.answers] }), true);
    assert.equal(matchesTrainingAttempt(attempt, { ...attempt, release_id: 'release-b' }), false);
    assert.equal(matchesTrainingAttempt(attempt, { ...attempt, track_slug: 'operations' }), false);
    assert.equal(matchesTrainingAttempt(attempt, { ...attempt, lesson_slug: 'opening' }), false);
    assert.equal(matchesTrainingAttempt(attempt, { ...attempt, answers: [0, 1] }), false);
  });
});
