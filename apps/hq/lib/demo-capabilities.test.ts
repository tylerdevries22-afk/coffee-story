import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { DEMO_MODULE_KEYS, resolveModuleKeys } from './capabilities';
import { TENANT_ORGS, tenantOrgById } from './tenants';

/**
 * The demo gates on the tenant you selected, not on the launch tenant.
 *
 * Demo mode is the only path the console takes with no database, so it is the
 * whole of what a reviewer sees. It used to answer with one hard-coded list
 * mirroring `tenants/coffee-story/modules.json` for *every* org, which meant
 * selecting Stillpoint Builders -- a construction franchise whose manifest
 * declares `construction-projects` and nothing else -- offered Drops,
 * Campaigns, Operations, Menu and Catalog, and hid the one module it runs.
 *
 * For a platform whose pitch is that the same five apps serve any industry,
 * that made the flagship demo demonstrate the opposite of its claim. These
 * assertions are the shape of the claim.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function manifestKeys(slug: string): string[] {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, 'tenants', slug, 'modules.json'), 'utf8'),
  ) as { modules: { key: string; enabled?: boolean }[] };
  return manifest.modules.filter((entry) => entry.enabled !== false).map((entry) => entry.key);
}

describe('demo capability resolution', () => {
  it('registers every tenant folder that ships a manifest', () => {
    assert.ok(TENANT_ORGS.length >= 3, `only ${TENANT_ORGS.length} orgs registered`);
    for (const org of TENANT_ORGS) {
      assert.ok(org.moduleKeys.length > 0, `${org.slug} declares no modules`);
    }
  });

  it('carries each tenant its own manifest, not a shared list', () => {
    for (const org of TENANT_ORGS) {
      assert.deepEqual([...org.moduleKeys].sort(), manifestKeys(org.slug).sort(),
        `${org.slug} drifted from tenants/${org.slug}/modules.json`);
    }
  });

  /**
   * The case that was wrong. Named directly rather than left to the general
   * rule above, because it is the one a reviewer opens the demo to see.
   */
  it('offers a construction franchise its own module and no commerce', async () => {
    const stillpoint = tenantOrgById('stillpoint-builders');
    assert.ok(stillpoint, 'stillpoint-builders is not registered');
    const keys = await resolveModuleKeys(null, 'stillpoint-builders');
    assert.ok(keys.has('construction-projects'),
      'the one module this tenant runs must be offered');
    for (const commerce of [
      'commerce-ordering', 'commerce-catering', 'commerce-delivery',
      'growth-drops', 'growth-stored-value', 'growth-referrals',
      'workforce-operations',
    ]) {
      assert.equal(keys.has(commerce), false,
        `a construction franchise was offered ${commerce}`);
    }
  });

  it('still answers the launch tenant with its full set', async () => {
    const coffeeStory = TENANT_ORGS.find((org) => org.slug === 'coffee-story')!;
    const keys = await resolveModuleKeys(null, coffeeStory.id);
    assert.deepEqual([...keys].sort(), manifestKeys('coffee-story').sort());
  });

  it('answers an unknown org with the launch set rather than nothing', async () => {
    // The fixture exists to make the console reviewable; an empty console
    // would read as a broken build rather than as an unconfigured one.
    const keys = await resolveModuleKeys(null, 'not-a-registered-org');
    assert.deepEqual([...keys].sort(), [...DEMO_MODULE_KEYS].sort());
  });

  it('keeps the fallback list equal to the launch tenant it claims to mirror', () => {
    assert.deepEqual([...DEMO_MODULE_KEYS].sort(), manifestKeys('coffee-story').sort(),
      'DEMO_MODULE_KEYS says it mirrors tenants/coffee-story/modules.json');
  });
});
