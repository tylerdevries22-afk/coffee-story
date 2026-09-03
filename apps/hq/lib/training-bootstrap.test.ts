import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mergeTrainingTemplate,
  normalizeTrainingProfile,
  prepareTrainingRelease,
  resolveTenantTrainingProfile,
  scoreTrainingQuiz,
  trainingProfileFromBrandConfig,
  validateTrainingManifest,
  validateTrainingProfile,
  type TrainingManifest,
} from './training-bootstrap';
import { trainingProfileFingerprint } from './training-fingerprint';

const PROFILE = { businessName: ' Coffee Story ', industry: ' Coffee ', locale: 'en-US', products: [' Latte ', 'Latte'] };

describe('training bootstrap contracts', () => {
  it('normalizes tenant input deterministically', () => {
    assert.deepEqual(normalizeTrainingProfile(PROFILE), {
      businessName: 'Coffee Story', industry: 'Coffee', locale: 'en-US', products: ['Latte'],
    });
  });

  it('creates the same fingerprint for equivalent profiles', () => {
    assert.equal(trainingProfileFingerprint(PROFILE), trainingProfileFingerprint(normalizeTrainingProfile(PROFILE)));
  });

  it('rejects incomplete or unsafe tenant profiles', () => {
    assert.deepEqual(validateTrainingProfile({ businessName: 'A', industry: '', locale: 'english', website: 'http://example.com' }), [
      'businessName must contain at least 2 characters',
      'industry must contain at least 2 characters',
      'locale must resemble en or en-US',
      'website must use public HTTPS',
    ]);
  });

  it('reads a valid tenant profile from brand configuration and rejects junk', () => {
    assert.deepEqual(trainingProfileFromBrandConfig({ training: { profile: PROFILE } }), normalizeTrainingProfile(PROFILE));
    assert.equal(trainingProfileFromBrandConfig({ training: { profile: { businessName: 'A' } } }), null);
  });

  it('derives a safe research profile when a tenant has not authored one yet', () => {
    // The template key is the tenant's own slug. It used to be set only for a
    // business literally named "Coffee Story", so every other tenant reached
    // the bootstrap with no key -- and regenerated a curriculum from scratch
    // rather than reusing the template someone had already published for them.
    assert.deepEqual(resolveTenantTrainingProfile('Still Point', { business: { website: 'https://stillpoint.example' } }), {
      businessName: 'Still Point', industry: 'Business operations and customer service', locale: 'en-US',
      templateKey: 'still-point', website: 'https://stillpoint.example',
    });
    // No version pin: the lookup takes the highest published version, so a
    // template republished at 2 is actually read.
    assert.equal(resolveTenantTrainingProfile('Still Point', {}).templateVersion, undefined);
    // A name that cannot produce a valid key leaves it unset rather than
    // writing one its own validator would reject.
    assert.equal(resolveTenantTrainingProfile('%%', {}).templateKey, undefined);
  });

  it('accepts a complete, sourced curriculum manifest', () => {
    const manifest: TrainingManifest = {
      schemaVersion: 3,
      generatedAt: '2026-08-24T00:00:00.000Z',
      tenant: normalizeTrainingProfile(PROFILE),
      sources: ['one', 'two', 'three', 'video'].map((value) => ({ title: value, publisher: value, url: `https://example.com/${value}`, accessedAt: '2026-08-24' })),
      tracks: ['knowledge', 'skills', 'service', 'safety', 'operations'].map((slug) => ({
        slug, title: slug, summary: slug, icon: { symbol: 'book', prompt: 'simple icon' },
        lessons: [{
          slug: 'basics', title: 'Basics', objective: 'Learn basics', content: 'Safe operating guidance with enough specific instructional detail to support a production-ready lesson for every assigned operator.', estimatedMinutes: 5,
          sourceUrls: ['https://example.com/one'],
          media: [{ kind: 'video', url: 'https://example.com/video', title: 'Video', rightsNote: 'Publisher-hosted training resource' }],
          quiz: [0, 1].map((correctChoice) => ({ prompt: 'Choose', choices: ['A', 'B'], correctChoice, explanation: 'Because.' })),
        }],
      })),
    };
    assert.deepEqual(validateTrainingManifest(manifest), []);
  });

  it('reports curriculum quality-gate failures', () => {
    const manifest: TrainingManifest = { schemaVersion: 3, generatedAt: '', tenant: normalizeTrainingProfile(PROFILE), sources: [], tracks: [] };
    assert.deepEqual(validateTrainingManifest(manifest), [
      'at least 3 research sources are required', 'all five core training tracks are required',
    ]);
  });

  it('scores complete quiz attempts with an 80 percent passing gate', () => {
    const questions = [0, 1, 0, 1, 0].map((correctChoice) => ({ prompt: 'Choose', choices: ['A', 'B'], correctChoice, explanation: 'Because.' }));
    assert.deepEqual(scoreTrainingQuiz(questions, [0, 1, 0, 1, 1]), { score: 80, passed: true });
    assert.deepEqual(scoreTrainingQuiz(questions, [0]), { score: 0, passed: false });
  });

  it('removes answer keys from the staff manifest while preserving server answers', () => {
    const manifest = {
      schemaVersion: 3 as const, generatedAt: '', tenant: normalizeTrainingProfile(PROFILE), sources: [],
      tracks: [{ slug: 'knowledge', title: 'Knowledge', summary: '', icon: { symbol: 'book', prompt: 'book' }, lessons: [{ slug: 'basics', title: 'Basics', objective: '', content: '', estimatedMinutes: 1, sourceUrls: [], media: [], quiz: [{ prompt: 'Q', choices: ['A', 'B'], correctChoice: 1, explanation: 'B' }] }] }],
    };
    const prepared = prepareTrainingRelease(manifest);
    assert.equal('correctChoice' in prepared.publicManifest.tracks[0]!.lessons[0]!.quiz[0]!, false);
    assert.deepEqual(prepared.answerKey, { knowledge: { basics: [1] } });
  });

  it('preserves untouched template lessons while applying researched overlays', () => {
    const lesson = (slug: string, title: string) => ({
      slug, title, objective: title, content: `${title} guidance`, estimatedMinutes: 5,
      sourceUrls: [], media: [], quiz: [],
    });
    const template: TrainingManifest = {
      schemaVersion: 3, generatedAt: '', tenant: normalizeTrainingProfile(PROFILE), sources: [],
      tracks: [{
        slug: 'knowledge', sortOrder: 0, title: 'Template knowledge', summary: 'Template',
        icon: { symbol: 'book', prompt: 'book' }, lessons: [lesson('baseline', 'Baseline'), lesson('shared', 'Template shared')],
      }],
    };
    const merged = mergeTrainingTemplate(template, {
      sources: [],
      tracks: [{
        slug: 'knowledge', sortOrder: 0, title: 'Research knowledge', summary: 'Research',
        icon: { symbol: 'book', prompt: 'book' }, lessons: [lesson('shared', 'Researched shared'), lesson('overlay', 'Overlay')],
      }],
    }, normalizeTrainingProfile(PROFILE));
    const knowledge = merged.tracks.find((track) => track.slug === 'knowledge');
    assert.deepEqual(knowledge?.lessons.map((item) => item.slug), ['shared', 'overlay', 'baseline']);
    assert.equal(knowledge?.lessons[0]?.title, 'Researched shared');
  });
});
