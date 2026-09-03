import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { liftTrainingManifest } from './training-manifest';
import { TRAINING_TRACK_ORDER } from './training';

const TENANT = { businessName: 'Riverbend Roasters', industry: 'Coffee', locale: 'en-US' };
const SAFETY = { slug: 'safety', title: 'Safety', summary: '', icon: { symbol: 'lock', prompt: 'lock' }, lessons: [] };

describe('training manifest lift', () => {
  it('reads a legacy release that spells the array modules', () => {
    const manifest = liftTrainingManifest({
      schemaVersion: 2, generatedAt: '', tenant: TENANT, sources: [], modules: [SAFETY],
    });
    assert.ok(manifest);
    assert.equal(manifest.modules.filter((module) => module.slug === 'safety').length, 1);
  });

  it('reads a schema 3 release that spells the array tracks', () => {
    // The reader has to accept 3 before any writer emits it: an operator build
    // published before the rename still has to open a release published after.
    const manifest = liftTrainingManifest({
      schemaVersion: 3, generatedAt: '', tenant: TENANT, sources: [], tracks: [SAFETY],
    });
    assert.ok(manifest);
    assert.equal(manifest.modules.filter((module) => module.slug === 'safety').length, 1);
    assert.equal(manifest.modules.length, TRAINING_TRACK_ORDER.length);
  });

  it('rejects a release whose array is missing, misspelled, or the wrong version', () => {
    assert.equal(liftTrainingManifest({ schemaVersion: 3, tenant: TENANT, sources: [], modules: [SAFETY] }), null);
    assert.equal(liftTrainingManifest({ schemaVersion: 4, tenant: TENANT, sources: [], tracks: [SAFETY] }), null);
    assert.equal(liftTrainingManifest({ schemaVersion: 2, tenant: TENANT, sources: [] }), null);
    assert.equal(liftTrainingManifest({ schemaVersion: 2, sources: [], modules: [] }), null);
    assert.equal(liftTrainingManifest([SAFETY]), null);
    assert.equal(liftTrainingManifest(null), null);
  });
});
