import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEMO_MODULE_KEYS,
  consoleCapabilitiesOf,
  resolveModuleKeys,
  type ModuleInstallationReader,
} from './capabilities';

const BRAND = '00000000-0000-4000-8000-000000000101';

function readerReturning(
  result: { data: { module_key: string }[] | null; error: unknown },
): { reader: ModuleInstallationReader; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    reader: async (brandId) => {
      calls.push(brandId);
      return result;
    },
  };
}

describe('resolveModuleKeys: the demo case', () => {
  it('resolves the demo set when there is no client at all', async () => {
    // `serverClient()` is null exactly when isConfigured() is false -- no
    // Supabase env, or the preview wall. Nothing was asked, so nothing was
    // denied, and a preview with every gated section hidden previews nothing.
    const keys = await resolveModuleKeys(null, BRAND);
    assert.deepEqual([...keys].sort(), [...DEMO_MODULE_KEYS].sort());
  });

  it('resolves the demo set even with no brand in scope', async () => {
    const keys = await resolveModuleKeys(null, null);
    assert.ok(keys.size > 0);
  });
});

describe('resolveModuleKeys: the denial case', () => {
  it('grants nothing when a configured deployment gets an error', async () => {
    // The point of this PR. A transient failure against a real database must
    // not read as "no restrictions"; it reads as "no answer, so nothing".
    const { reader } = readerReturning({ data: null, error: { message: 'PGRST301' } });
    assert.equal((await resolveModuleKeys(reader, BRAND)).size, 0);
  });

  it('grants nothing when an error arrives alongside rows', async () => {
    // PostgREST does not do this, but the type admits it, and "there were some
    // rows" is not a reason to trust a failed read.
    const { reader } = readerReturning({
      data: [{ module_key: 'workforce-operations' }],
      error: new Error('read replica rejected the token'),
    });
    assert.equal((await resolveModuleKeys(reader, BRAND)).size, 0);
  });

  it('grants nothing when the answer is absent without an error', async () => {
    const { reader } = readerReturning({ data: null, error: null });
    assert.equal((await resolveModuleKeys(reader, BRAND)).size, 0);
  });

  it('never asks when a configured deployment has no brand in scope', async () => {
    const { reader, calls } = readerReturning({ data: [{ module_key: 'growth-drops' }], error: null });
    assert.equal((await resolveModuleKeys(reader, null)).size, 0);
    assert.deepEqual(calls, [], 'a brandless read would be a whole-table read');
  });
});

describe('resolveModuleKeys: the configured case', () => {
  it('returns exactly the installed keys, scoped to the brand asked for', async () => {
    const { reader, calls } = readerReturning({
      data: [{ module_key: 'growth-drops' }, { module_key: 'workforce-operations' }],
      error: null,
    });
    const keys = await resolveModuleKeys(reader, BRAND);
    assert.deepEqual([...keys].sort(), ['growth-drops', 'workforce-operations']);
    assert.deepEqual(calls, [BRAND]);
  });

  it('returns an empty set for a brand that has installed nothing', async () => {
    // Distinct from the denial above only in provenance, and identical in
    // effect, which is the correct outcome for both.
    const { reader } = readerReturning({ data: [], error: null });
    assert.equal((await resolveModuleKeys(reader, BRAND)).size, 0);
  });
});

describe('consoleCapabilitiesOf', () => {
  it('gates operations on the module that provides it', () => {
    assert.equal(consoleCapabilitiesOf(new Set(['workforce-operations'])).operations, true);
    assert.equal(consoleCapabilitiesOf(new Set(['growth-drops'])).operations, false);
  });

  it('gates drops on growth-drops alone', () => {
    assert.equal(consoleCapabilitiesOf(new Set(['growth-drops'])).drops, true);
    assert.equal(consoleCapabilitiesOf(new Set(['commerce-ordering'])).drops, false);
  });

  it('gates campaigns on holding any growth module', () => {
    assert.equal(consoleCapabilitiesOf(new Set(['growth-referrals'])).growth, true);
    assert.equal(consoleCapabilitiesOf(new Set(['growth-stored-value'])).growth, true);
    assert.equal(consoleCapabilitiesOf(new Set(['commerce-catalog'])).growth, false);
  });

  it('denies every console capability on a denied resolve', () => {
    assert.deepEqual(consoleCapabilitiesOf(new Set()), {
      operations: false, drops: false, growth: false,
    });
  });

  it('answers for the demo set the way the demo tenant is installed', () => {
    const demo = consoleCapabilitiesOf(new Set(DEMO_MODULE_KEYS));
    assert.equal(demo.operations, true);
    assert.equal(demo.drops, true);
    assert.equal(demo.growth, true);
  });
});
