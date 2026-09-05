import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { completionReport, constructionTrainingManifest, isConstructionTrainingProfile, lessonsForPath, remindersFor, type TrainingAssignment } from './training-workforce';

describe('training workforce paths', () => {
  const manifest = constructionTrainingManifest({
    businessName: 'Northstar Projects', industry: 'Construction and renovation',
    locale: 'en-US', templateKey: 'northstar-field',
  });
  it('selects trade-specific lessons', () => {
    assert.ok(lessonsForPath(manifest, 'staff', 'foreman').some((lesson) => lesson.slug === 'pre-task-plan'));
    assert.equal(manifest.tenant.templateKey, 'northstar-field');
    assert.doesNotMatch(JSON.stringify(manifest), /stillpoint/i);
    assert.ok(isConstructionTrainingProfile(manifest.tenant));
    assert.ok(isConstructionTrainingProfile({ industry: '', templateKey: 'regional-construction' }));
    assert.equal(isConstructionTrainingProfile({ industry: 'Coffee shop', templateKey: 'stillpoint-builders' }), false);
    assert.equal(constructionTrainingManifest({
      businessName: 'Northstar Projects', industry: 'Construction', locale: 'en-US',
    }).tenant.templateKey, 'construction');
  });
  it('reports completion, sign-offs, and expiry states', () => {
    const assignments: TrainingAssignment[] = [
      { trackSlug: 'safety', lessonSlug: 'incident-response', role: 'staff', trade: 'foreman', status: 'complete', certificationExpiresAt: '2026-09-20' },
      { trackSlug: 'field-skills', lessonSlug: 'pre-task-plan', role: 'staff', trade: 'foreman', status: 'in_progress' },
    ];
    assert.deepEqual(completionReport(assignments, new Date('2026-09-04')), { total: 2, completed: 1, percent: 50, signOffRequired: 1, certifications: { current: 0, expiring: 1, expired: 0 } });
    assert.equal(remindersFor(assignments, new Date('2026-09-04')).length, 3);
  });
});
