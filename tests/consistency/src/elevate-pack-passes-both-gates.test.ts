/**
 * Elevate Web Dev Solutions owns the tenant pack schema; this repo consumes it.
 * That split is only real if something checks it, and until now nothing did --
 * every generated pack claimed to be compatible in its own README while the
 * one pack that existed failed this repo's parser on two fields, unnoticed,
 * because no test ever fed one repo's output to the other's validator.
 *
 * `fixtures/elevate-pack/elevate-web-demo/` is a pack in the unified shape, as
 * Elevate emits it. Both of this repo's gates run against it here:
 *
 *   parseTenantManifest   -- is this a well-formed pack?
 *   validateTenant        -- can this repo build from it?
 *
 * Those are different questions, and the split between them is the contract.
 * Elevate decides the first; this repo decides the second and must not fail a
 * pack merely because part of it is hosted elsewhere. A schema change on either
 * side lands here rather than at deploy.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseTenantManifest } from '../../../packages/tenant-config/src/parser';
import { TenantValidationError, validateTenant } from '../../../scripts/lib/onboard-validation';

const ROOT = join(process.cwd(), '..', '..');
const SLUG = 'elevate-web-demo';
const PACK = join(ROOT, 'tests', 'consistency', 'fixtures', 'elevate-pack', SLUG);

function brand(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(PACK, 'brand.json'), 'utf8')) as Record<string, unknown>;
}

describe('a tenant pack in the shape Elevate emits', () => {
  // Without this, the fixture could be "fixed" into something that no longer
  // exercises any of the three widenings, and the suite below would go on
  // passing while proving nothing.
  describe('exercises what it claims to', () => {
    it('declares a surface this repo does not build', () => {
      assert.ok((brand().surfaces as string[]).includes('admin'),
        'fixture no longer declares admin -- it cannot prove the surface widening');
    });

    it('carries socials as a top-level key, not a business field', () => {
      const raw = brand();
      assert.ok(raw.socials, 'fixture no longer has top-level socials');
      assert.equal((raw.business as Record<string, unknown>).socials, undefined,
        'fixture nests socials under business again -- the adapter step is untested');
    });

    it('leaves kiosk identity empty, as a tenant with no kiosk does', () => {
      const identity = brand().identity as Record<string, string>;
      assert.equal(identity.kioskBundleId, '');
      assert.equal(identity.kioskScheme, '');
      assert.ok(!(brand().surfaces as string[]).includes('kiosk'));
    });

    it('names modules this repo does not ship', () => {
      const modules = JSON.parse(
        readFileSync(join(PACK, 'modules.json'), 'utf8'),
      ) as { modules: { key: string; surfaces: string[] }[] };
      assert.deepEqual(modules.modules.map((m) => m.key), ['web-services', 'mcp-store']);
      for (const module of modules.modules) {
        assert.deepEqual(module.surfaces, ['admin'],
          `${module.key} must be scoped to admin, or this repo is right to reject it`);
      }
    });
  });

  it('is a well-formed pack', () => {
    const result = parseTenantManifest(brand());
    assert.equal(result.kind, 'ok',
      result.kind === 'invalid' ? result.issues.join('; ') : '');
  });

  it('is one this repo can build from', () => {
    try {
      const validated = validateTenant({
        tenantDir: PACK, slug: SLUG, scaffold: false,
        apply: false, requireDatabase: false, allowImagelessFixture: true,
      });
      assert.equal(validated.brand.identity.slug, SLUG);
      assert.deepEqual(validated.guestSurfaces, ['customer']);
    } catch (error) {
      if (error instanceof TenantValidationError) {
        assert.fail(`validateTenant rejected an Elevate pack: ${error.problems.join('; ')}`);
      }
      throw error;
    }
  });
});
