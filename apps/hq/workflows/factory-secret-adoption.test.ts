import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { verifyAdoption } from './factory-provider-adoption';
import {
  supabaseProjectFromLookup,
  verifiedDopplerResource,
  verifiedSupabaseResource,
} from './factory-secret-adoption';

const dopplerExpected = { project: 'stillpoint-builders' };
const dopplerPayload = { id: 'project_stillpoint', name: 'stillpoint-builders' };
const supabaseExpected = {
  project: 'stillpoint-builders', region: 'us-west-1', organizationSlug: 'platform-org',
};
const supabasePayload = {
  ref: 'abcdefghijklmnopqrst', name: 'stillpoint-builders', region: 'us-west-1',
  status: 'ACTIVE_HEALTHY', organization_slug: 'platform-org', is_branch: false,
};

describe('secret provider adoption', () => {
  it('reuses matching Doppler and Supabase resources without creating', async () => {
    const cases = [
      {
        stored: verifiedDopplerResource(dopplerPayload, dopplerExpected, null),
        payload: dopplerPayload,
        verify: (value: unknown, stored: Parameters<typeof verifiedDopplerResource>[2]) => (
          verifiedDopplerResource(value, dopplerExpected, stored)
        ),
      },
      {
        stored: verifiedSupabaseResource(supabasePayload, supabaseExpected, null),
        payload: supabasePayload,
        verify: (value: unknown, stored: Parameters<typeof verifiedSupabaseResource>[2]) => (
          verifiedSupabaseResource(value, supabaseExpected, stored)
        ),
      },
    ];
    for (const testCase of cases) {
      const result = await verifyAdoption({
        stored: testCase.stored,
        lookup: async () => testCase.payload,
        create: async () => { throw new Error('must not create'); },
        verify: testCase.verify,
      });
      assert.equal(result.persist, false);
      assert.deepEqual(result.resource, testCase.stored);
    }
  });

  it('rejects provider and stored provenance mismatches', () => {
    const doppler = verifiedDopplerResource(dopplerPayload, dopplerExpected, null);
    const supabase = verifiedSupabaseResource(supabasePayload, supabaseExpected, null);
    assert.throws(() => verifiedDopplerResource(
      { ...dopplerPayload, name: 'other-tenant' }, dopplerExpected, doppler,
    ), /identity/);
    assert.throws(() => verifiedSupabaseResource(
      { ...supabasePayload, region: 'eu-west-1' }, supabaseExpected, supabase,
    ), /provenance|status/);
    assert.throws(() => verifiedSupabaseResource(
      { ...supabasePayload, status: 'INACTIVE' }, supabaseExpected, supabase,
    ), /provenance|status/);
    assert.throws(() => verifiedSupabaseResource(
      supabasePayload, supabaseExpected, { ...supabase, externalId: 'other-ref' },
    ), /provenance/);
  });

  it('fails closed when stored resources disappear from either provider', async () => {
    const cases = [
      {
        stored: verifiedDopplerResource(dopplerPayload, dopplerExpected, null),
        verify: (value: unknown) => verifiedDopplerResource(value, dopplerExpected, null),
      },
      {
        stored: verifiedSupabaseResource(supabasePayload, supabaseExpected, null),
        verify: (value: unknown) => verifiedSupabaseResource(value, supabaseExpected, null),
      },
    ];
    for (const testCase of cases) {
      await assert.rejects(verifyAdoption({
        stored: testCase.stored,
        lookup: async () => null,
        create: async () => { throw new Error('must not create'); },
        verify: testCase.verify,
      }), /no longer exists/);
    }
  });

  it('rejects malformed provider responses', () => {
    for (const payload of [{}, [], { id: 7, name: 'stillpoint-builders' }]) {
      assert.throws(() => verifiedDopplerResource(payload, dopplerExpected, null), /identity/);
    }
    for (const payload of [
      {}, [], { ...supabasePayload, ref: undefined },
      { ...supabasePayload, status: undefined },
    ]) {
      assert.throws(() => verifiedSupabaseResource(payload, supabaseExpected, null), /provenance|status/);
    }
    assert.throws(() => supabaseProjectFromLookup({ projects: {} }, supabaseExpected.project),
      /invalid response/);
  });
});
