import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { FatalError } from '@workflow/errors';

import { githubArtifactDigest } from './factory-github-actions';
import { database, requiredEnvironment, type SafeResource } from './factory-runtime';
import { verifiedDopplerResource } from './factory-secret-adoption';

/**
 * The Workflow runtime retries a step that throws a plain Error. These are
 * the refusals no retry can change -- configuration that is not there, a value
 * that is malformed, a resource that is provably not the one on record -- so
 * each has to stop its step at once instead of spending the retry budget and
 * the wall-clock of a run that has already failed.
 *
 * Deliberately not converted: anything decided by a live provider read, which
 * can be briefly stale right after a create.
 */
describe('deterministic factory refusals', () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };

  afterEach(() => {
    if (saved.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  });

  it('stops on missing provider configuration', () => {
    assert.throws(() => requiredEnvironment('FACTORY_REFUSALS_TEST_NEVER_SET'), FatalError);
  });

  it('stops when the factory database is not configured', () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.throws(() => database(), FatalError);
  });

  it('stops on a malformed deployment artifact digest', () => {
    assert.throws(() => githubArtifactDigest('not-a-digest'), FatalError);
  });

  it('stops when the stored resource is not the one the provider returned', () => {
    const stored: SafeResource = {
      provider: 'doppler', kind: 'project', environment: 'production',
      externalId: 'someone-elses-project', displayName: 'harbor-roast',
      metadata: { project: 'harbor-roast', providerId: 'someone-elses-project' },
    };
    assert.throws(
      () => verifiedDopplerResource({ id: 'doppler-project-1', name: 'harbor-roast' }, { project: 'harbor-roast' }, stored),
      FatalError,
    );
  });

  it('still retries an identity mismatch from a live provider read', () => {
    assert.throws(
      () => verifiedDopplerResource({ id: 'doppler-project-1', name: 'another-tenant' }, { project: 'harbor-roast' }, null),
      (error) => error instanceof Error && !(error instanceof FatalError),
    );
  });
});
