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
 * selecting Stillpoint Builders must expose its construction-specific module
 * set without leaking Coffee Story growth or hospitality capabilities.
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
  it('offers the construction franchise its complete tenant module set', async () => {
    const stillpoint = tenantOrgById('stillpoint-builders');
    assert.ok(stillpoint, 'stillpoint-builders is not registered');
    const keys = await resolveModuleKeys(null, 'stillpoint-builders');
    assert.deepEqual([...keys].sort(), manifestKeys('stillpoint-builders').sort());
    for (const hospitality of [
      'commerce-catering', 'commerce-delivery', 'growth-drops',
      'growth-stored-value', 'growth-referrals',
    ]) {
      assert.equal(keys.has(hospitality), false,
        `a construction franchise was offered ${hospitality}`);
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

  /**
   * `tenantOrgById` is an array `find` with strict equality, so a prototype key
   * cannot reach it -- but the same class of bug did reach the slot resolver
   * (`slots['constructor']` walked the chain to `Object` and resolved), so the
   * property is worth pinning here rather than left to the implementation.
   */
  it('treats a prototype-chain key as an unknown org', async () => {
    for (const hostile of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      assert.equal(tenantOrgById(hostile), null, hostile);
      const keys = await resolveModuleKeys(null, hostile);
      assert.deepEqual([...keys].sort(), [...DEMO_MODULE_KEYS].sort(),
        `${hostile} resolved to something other than the fallback`);
    }
  });

  it('keeps the fallback list equal to the launch tenant it claims to mirror', () => {
    assert.deepEqual([...DEMO_MODULE_KEYS].sort(), manifestKeys('coffee-story').sort(),
      'DEMO_MODULE_KEYS says it mirrors tenants/coffee-story/modules.json');
  });

  it('gives every registry location its own zone and hours, not a default', () => {
    // The synthesized default was `America/New_York` with retail hours for every
    // org but the launch tenant, which put a shop's trading day on a
    // construction regional office in Colorado. A location states its own or
    // the type will not compile.
    for (const org of TENANT_ORGS) {
      for (const location of org.locations) {
        assert.match(location.timezone, /^[A-Za-z]+\/[A-Za-z_]+$/, `${org.slug}/${location.id} zone`);
        assert.ok(location.hours.length > 0, `${org.slug}/${location.id} hours`);
      }
    }
    const stillpoint = TENANT_ORGS.find((org) => org.slug === 'stillpoint-builders');
    assert.ok(stillpoint);
    for (const location of stillpoint.locations) {
      assert.equal(location.timezone, 'America/Denver', 'both sites are in Colorado');
    }
  });
});
