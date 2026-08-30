import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cafeTrainingManifest,
} from './training-baseline';
import { normalizeTrainingManifest, scoreTrainingQuiz, TRAINING_TRACK_ORDER } from './training';

describe('training manifest v2', () => {
  it('seeds the franchise baseline with five tracks and fifteen lessons', () => {
    const manifest = cafeTrainingManifest({ businessName: 'Coffee Story', industry: 'Coffee', locale: 'en-US' });
    assert.equal(manifest.schemaVersion, 2);
    assert.deepEqual(manifest.modules.map((module) => module.trackKey), [...TRAINING_TRACK_ORDER]);
    assert.equal(manifest.modules.reduce((total, module) => total + module.lessons.length, 0), 15);
    const sanitation = manifest.modules.find((module) => module.trackKey === 'safety')?.lessons
      .find((lesson) => lesson.slug === 'chemicals-and-incidents');
    assert.deepEqual(sanitation?.grantsCompetencyKeys, ['restroom-sanitation']);
    assert.equal(sanitation?.competencyValidityDays, 365);
  });

  it('names the tenant it was handed, and nobody else', () => {
    // The baseline is the shared starting template. It used to say "Coffee
    // Story" in a lesson title, an objective, and the body every lesson without
    // its own copy falls back to -- so the second shop on the platform would
    // have trained its staff on the first shop's procedure, by name.
    const manifest = cafeTrainingManifest({ businessName: 'Riverbend Roasters', industry: 'Coffee', locale: 'en-US' });
    const lessons = manifest.modules.flatMap((module) => module.lessons);
    const written = lessons.flatMap((lesson) => [lesson.title, lesson.objective, lesson.content]);
    for (const text of written) assert.doesNotMatch(text, /coffee story/i);
    assert.ok(lessons.some((lesson) => lesson.title === 'Tell the Riverbend Roasters menu'));
    for (const text of written) assert.doesNotMatch(text, /\{brand\}/);
  });

  it('derives a template key per tenant, keeping the first tenant on its own', () => {
    // slugify('Coffee Story') is the key its published templates are already
    // stored under, so generalizing the default did not orphan them.
    assert.equal(cafeTrainingManifest({ businessName: 'Coffee Story', industry: 'Coffee', locale: 'en-US' }).tenant.templateKey, 'coffee-story');
    assert.equal(cafeTrainingManifest({ businessName: 'Riverbend Roasters', industry: 'Coffee', locale: 'en-US' }).tenant.templateKey, 'riverbend-roasters');
    // Left unset on purpose: the lookup then takes the highest published
    // version instead of pinning every tenant to the first one ever published.
    assert.equal(cafeTrainingManifest({ businessName: 'Coffee Story', industry: 'Coffee', locale: 'en-US' }).tenant.templateVersion, undefined);
    assert.equal(cafeTrainingManifest({ businessName: '  ', industry: 'Coffee', locale: 'en-US' }).tenant.templateKey, 'shop');
  });

  it('upgrades legacy modules without changing their portable slugs', () => {
    const manifest = normalizeTrainingManifest({
      schemaVersion: 1,
      generatedAt: '',
      tenant: { businessName: 'Coffee Story', industry: 'Coffee', locale: 'en-US' },
      sources: [],
      modules: [{ slug: 'service', title: 'Service', summary: '', icon: { symbol: 'star', prompt: 'star' }, lessons: [] }],
    });
    assert.equal(manifest.schemaVersion, 2);
    const service = manifest.modules.find((module) => module.trackKey === 'service');
    assert.equal(service?.trackKey, 'service');
    assert.equal(service?.slug, 'service');
  });

  it('adds visible empty shells for core tracks missing from a legacy release', () => {
    const manifest = normalizeTrainingManifest({
      schemaVersion: 1,
      generatedAt: '',
      tenant: { businessName: 'Example', industry: 'Retail', locale: 'en-US' },
      sources: [],
      modules: [{ slug: 'skills', title: 'Skills', summary: '', icon: { symbol: 'wrench', prompt: '' }, lessons: [] }],
    });
    assert.deepEqual(manifest.modules.map((module) => module.trackKey), [...TRAINING_TRACK_ORDER]);
    assert.equal(manifest.modules.find((module) => module.trackKey === 'safety')?.lessons.length, 0);
  });

  it('scores quizzes deterministically and fails closed for incomplete answers', () => {
    const questions = [
      { prompt: 'One', choices: ['A', 'B'], correctChoice: 0, explanation: '' },
      { prompt: 'Two', choices: ['A', 'B'], correctChoice: 1, explanation: '' },
    ];
    assert.deepEqual(scoreTrainingQuiz(questions, [0, 1]), { score: 100, passed: true });
    assert.deepEqual(scoreTrainingQuiz(questions, [0]), { score: 0, passed: false });
  });
});
