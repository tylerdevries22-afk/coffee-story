/**
 * A tenant folder created from the HQ console must be one this repo can onboard.
 *
 * It was not. `tenantPackFromSetup` emitted five files where
 * `tenants/_template/` has thirteen, and three of the omissions were load
 * bearing:
 *
 *   * no `release.json`, which the factory publisher requires outright, so the
 *     folder could never be published
 *   * `surfaces: [customer, kiosk, operator, display, hq]` on every module,
 *     which is wrong for any module not serving all five -- `commerce-catalog`
 *     serves four
 *   * `config: "modules/<key>.json"`, a file the generator never wrote
 *
 * Each failed validation, so an organization created from the console produced
 * a folder that failed `pnpm onboard` and nothing said so until much later, in
 * a place that did not name the cause.
 *
 * The generator self-validates its own brand.json, which is why the first
 * problem hid for so long: that check passed while the folder as a whole did
 * not. This runs the whole folder through the real gate instead.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { tenantPackFromSetup } from '../../../packages/tenant-config/src/pack-from-setup';
import { writeTenantPack } from '../../../apps/hq/lib/tenant-pack-write';
import { TenantValidationError, validateTenant } from '../../../scripts/lib/onboard-validation';

const SLUG = 'harbor-roast';

function generatedPackDirectory(): { root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'console-pack-'));
  const dir = writeTenantPack(root, tenantPackFromSetup({
    slug: SLUG,
    name: 'Harbor Roast',
    ownerEmail: 'owner@harbor.example',
    organizationKind: 'independent',
    networkSlug: null,
    location: {
      name: 'Waterfront',
      address: { street: '12 Pier', city: 'Tacoma', region: 'WA', postal: '98402' },
      timezone: 'America/Los_Angeles',
      hours: { mon: [{ open: '07:00', close: '15:00' }] },
    },
    modules: [{ key: 'commerce-catalog', version: '1.0.0' }],
  }));
  return { root, dir };
}

describe('a tenant folder created from the console', () => {
  const { root, dir } = generatedPackDirectory();
  after(() => rmSync(root, { recursive: true, force: true }));

  it('passes the same onboarding validation every other tenant passes', () => {
    try {
      const validated = validateTenant({
        tenantDir: dir, slug: SLUG, scaffold: false,
        apply: false, requireDatabase: false, allowImagelessFixture: true,
      });
      assert.equal(validated.brand.identity.slug, SLUG);
    } catch (error) {
      if (error instanceof TenantValidationError) {
        assert.fail(`the console's own pack does not validate: ${error.problems.join('; ')}`);
      }
      throw error;
    }
  });

  it('carries the release.json the factory publisher requires', () => {
    const pack = tenantPackFromSetup({
      slug: SLUG, name: 'Harbor Roast', ownerEmail: 'owner@harbor.example',
      organizationKind: 'independent', networkSlug: null, location: null,
      modules: [],
    });
    const release = pack.files['release.json'] as Record<string, unknown>;
    assert.equal(release.schemaVersion, 2);
    assert.equal(release.tenantSlug, SLUG);
  });
});
