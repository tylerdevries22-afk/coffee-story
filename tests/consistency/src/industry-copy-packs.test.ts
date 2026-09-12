import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { parseIndustryBlueprint } from '../../../packages/module-kit/src/blueprint.ts';
import {
  GENERIC_COPY, GENERIC_INDUSTRY_KEY, INDUSTRY_COPY, VERTICAL_COPY_KEYS,
  brandIndustryKey, industryCopy,
} from '../../../packages/ui/src/copy-industry.ts';
import { UNIVERSAL_COPY, resolveCopy } from '../../../packages/ui/src/copy.ts';

/**
 * The gate on the industry copy layer.
 *
 * Before this layer existed, a tenant that was not a coffee shop inherited a
 * coffee shop's words for every key it did not override, and nothing said so:
 * stillpoint-builders overrode eight keys and silently shipped "Add to Bag"
 * and a promise to call your name at a counter for the rest. The fix is only
 * half a fix if the next vertical can repeat it, so what is checked here is
 * not that today's wording is right -- it is that *adding* a vertical is what
 * trips the wire. A new industries/<key>/blueprint.json with no pack fails, a
 * tenant naming a pack that does not exist fails, and a pack missing any key
 * the vertical owns fails.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const INDUSTRIES = join(ROOT, 'industries');
const TENANTS = join(ROOT, 'tenants');

/** Every shipped industry. `_template` is scaffolding, not an industry. */
function blueprintKeys(): string[] {
  return readdirSync(INDUSTRIES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_template')
    .filter((entry) => existsSync(join(INDUSTRIES, entry.name, 'blueprint.json')))
    .map((entry) => entry.name)
    .sort();
}

/** Every tenant folder, the template included: it is authored like the rest. */
function tenantSlugs(): string[] {
  return readdirSync(TENANTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(TENANTS, entry.name, 'brand.json')))
    .map((entry) => entry.name)
    .sort();
}

function brandConfig(slug: string): unknown {
  return JSON.parse(readFileSync(join(TENANTS, slug, 'brand.json'), 'utf8')) as unknown;
}

describe('industry copy packs', () => {
  it('finds the industries and tenants it is meant to guard', () => {
    // Without this the suites below pass vacuously the day either layout moves.
    const industries = blueprintKeys();
    const tenants = tenantSlugs();
    assert.ok(industries.includes('coffee-shop'), `industries: ${industries.join(', ')}`);
    assert.ok(industries.includes('construction'), `industries: ${industries.join(', ')}`);
    assert.ok(tenants.includes('_template'), `tenant folders: ${tenants.join(', ')}`);
    assert.ok(tenants.length >= 4, `only ${tenants.length} tenant folders found`);
  });

  for (const folder of blueprintKeys()) {
    it(`${folder} declares its folder name and ships a copy pack`, () => {
      const raw = JSON.parse(
        readFileSync(join(INDUSTRIES, folder, 'blueprint.json'), 'utf8'),
      ) as unknown;
      const parsed = parseIndustryBlueprint(raw);
      assert.equal(parsed.kind, 'ok', `industries/${folder}: ${JSON.stringify(parsed)}`);
      if (parsed.kind !== 'ok') return;

      // The pack is keyed by the blueprint's own key, not by the folder, so
      // the two must agree or a tenant would name one and resolve the other.
      assert.equal(parsed.blueprint.key, folder,
        `industries/${folder}/blueprint.json declares key "${parsed.blueprint.key}"`);
      assert.ok(INDUSTRY_COPY[folder],
        `industries/${folder} has no pack in packages/ui/src/copy-industry.ts -- `
        + 'a vertical with no wording of its own inherits another vertical\'s');
    });
  }

  for (const [key, pack] of Object.entries(INDUSTRY_COPY)) {
    it(`the ${key} pack supplies every key the vertical owns`, () => {
      for (const copyKey of VERTICAL_COPY_KEYS) {
        const value = pack[copyKey];
        assert.equal(typeof value, 'string', `${key} pack is missing "${copyKey}"`);
        assert.ok(value.length > 0, `${key} pack leaves "${copyKey}" empty`);
      }
      const extra = Object.keys(pack).filter(
        (copyKey) => !(VERTICAL_COPY_KEYS as readonly string[]).includes(copyKey),
      );
      // An extra key reads as industry wording but is never resolved, because
      // a tenant that does not override it falls through to the universal layer.
      assert.deepEqual(extra, [], `${key} pack declares keys no layer reads`);
    });
  }

  it('keeps the universal layer clear of keys a pack owns', () => {
    const overlap = VERTICAL_COPY_KEYS.filter((key) => key in UNIVERSAL_COPY);
    assert.deepEqual(overlap, [],
      'UNIVERSAL_COPY duplicates industry keys, so its wording is dead and misleading');
  });

  for (const slug of tenantSlugs()) {
    it(`${slug} names an industry pack the platform ships`, () => {
      const key = brandIndustryKey(brandConfig(slug));
      assert.ok(key,
        `tenants/${slug}/brand.json declares no business.industryKey; `
        + `use an industries/<key> folder name or "${GENERIC_INDUSTRY_KEY}"`);
      assert.ok(INDUSTRY_COPY[key ?? ''],
        `tenants/${slug}/brand.json names industry "${key ?? ''}", which has no copy pack`);
    });
  }
});

/**
 * The fail-safe, checked as behavior rather than as a comment.
 *
 * Brand configs also arrive from the `brand_storefront` row, and a row written
 * before `business.industryKey` existed carries no key at all. Those must read
 * as nobody's industry. If somebody ever makes a vertical the fallback again,
 * this is what says so.
 */
describe('a brand with no industry', () => {
  it('resolves to the generic pack', () => {
    assert.equal(industryCopy(undefined), GENERIC_COPY);
    assert.equal(industryCopy('an-industry-nobody-wrote'), GENERIC_COPY);
    assert.equal(industryCopy(42), GENERIC_COPY);
    // The database spells its neutral industry `general`, not `generic`.
    assert.equal(industryCopy('general'), GENERIC_COPY);
  });

  it('never inherits a vertical it did not name', () => {
    const neutral = resolveCopy(null);
    for (const [key, pack] of Object.entries(INDUSTRY_COPY)) {
      if (key === GENERIC_INDUSTRY_KEY) continue;
      const borrowed = VERTICAL_COPY_KEYS.filter(
        (copyKey) => pack[copyKey] !== GENERIC_COPY[copyKey] && neutral[copyKey] === pack[copyKey],
      );
      assert.deepEqual(borrowed, [], `neutral wording borrowed from the ${key} pack`);
    }
  });

  it('reads a key off a brand config the way the apps do', () => {
    assert.equal(brandIndustryKey({ business: { industryKey: 'construction' } }), 'construction');
    assert.equal(brandIndustryKey({ business: { industry: 'Construction and renovation' } }), undefined);
    assert.equal(brandIndustryKey({ business: { industryKey: 7 } }), undefined);
    assert.equal(brandIndustryKey(null), undefined);
  });
});
