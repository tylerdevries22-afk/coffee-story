import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import {
  HQ_TENANT_REGISTRY,
  hqTenantSlugs,
  renderHqTenantRegistry,
  writeHqTenantRegistry,
} from '../../../scripts/hq-tenant-registry.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * The console's tenant registry is generated from tenants/, so a tenant folder
 * is in the organization switcher on the commit that adds it.
 *
 * It used to be ten hand-written JSON imports and a five-entry list, and
 * nothing scanned the tree: a new tenant folder was invisible to HQ until
 * someone remembered to edit that file, which is the failure a generated
 * registry removes and this test keeps removed.
 *
 * Asserted against the real generator over a temporary tree, as the guest
 * barrels are in tenant-slots.test.ts, and then against this checkout.
 */
const temporary: string[] = [];
after(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'hq-tenant-registry-'));
  temporary.push(root);
  mkdirSync(join(root, 'tenants'), { recursive: true });
  mkdirSync(join(root, dirname(HQ_TENANT_REGISTRY)), { recursive: true });
  return root;
}

const BOTH = ['brand.json', 'modules.json'] as const;

function seedTenant(root: string, slug: string, files: readonly string[] = BOTH): void {
  const directory = join(root, 'tenants', slug);
  mkdirSync(directory, { recursive: true });
  if (files.includes('brand.json')) {
    writeFileSync(join(directory, 'brand.json'), JSON.stringify({ identity: { slug, name: slug } }));
  }
  if (files.includes('modules.json')) {
    writeFileSync(join(directory, 'modules.json'), JSON.stringify({ modules: [] }));
  }
}

function naming(fragment: string): (error: unknown) => boolean {
  return (error) => error instanceof Error && error.message.includes(fragment);
}

describe('generating the HQ tenant registry', () => {
  it('skips the template, other scaffolding, dot directories and loose files', () => {
    const root = fixtureRoot();
    seedTenant(root, '_template');
    seedTenant(root, '_draft-shop');
    seedTenant(root, '.cache');
    seedTenant(root, 'brand-a');
    writeFileSync(join(root, 'tenants', 'README.md'), '# Tenants\n');

    assert.deepEqual(hqTenantSlugs(root), ['brand-a']);
    assert.doesNotMatch(renderHqTenantRegistry(hqTenantSlugs(root)), /_template|_draft|\.cache/);
  });

  it('refuses a folder name that is not a tenant slug, naming the folder', () => {
    // Each would reach generated TypeScript as an import path and a literal.
    for (const bad of ['Brand-A', 'brand_a', "brand'a"]) {
      const root = fixtureRoot();
      seedTenant(root, bad);
      assert.throws(() => hqTenantSlugs(root), naming(`tenants/${bad} is not a kebab-case tenant slug`), bad);
    }
    assert.throws(() => renderHqTenantRegistry(['../outside']), /is not a kebab-case tenant slug/);
  });

  it('refuses a tenant folder missing either manifest, naming the folder and the file', () => {
    const noModules = fixtureRoot();
    seedTenant(noModules, 'brand-a', ['brand.json']);
    assert.throws(() => hqTenantSlugs(noModules), naming('tenants/brand-a has no modules.json'));

    const noBrand = fixtureRoot();
    seedTenant(noBrand, 'brand-a', ['modules.json']);
    assert.throws(() => hqTenantSlugs(noBrand), naming('tenants/brand-a has no brand.json'));
  });

  it('refuses slugs whose generated identifiers would collide', () => {
    // `a-1` and `a1` both become `A1`; the module would not compile.
    assert.throws(() => renderHqTenantRegistry(['a-1', 'a1']), /both generate the identifier A1/);
    assert.throws(() => renderHqTenantRegistry(['brand-a', 'brand-a']), /both generate/);
  });

  it('renders the same bytes, sorted by slug, whatever order the folders arrive in', () => {
    const root = fixtureRoot();
    for (const slug of ['zeta-shop', 'alpha', 'mid-2']) seedTenant(root, slug);

    const slugs = hqTenantSlugs(root);
    assert.deepEqual(slugs, ['alpha', 'mid-2', 'zeta-shop']);
    const rendered = renderHqTenantRegistry(slugs);
    assert.equal(renderHqTenantRegistry([...slugs].reverse()), rendered);
    assert.deepEqual(
      [...rendered.matchAll(/\{ slug: '([^']+)'/g)].map((match) => match[1]),
      ['alpha', 'mid-2', 'zeta-shop'],
    );
  });

  it('names every path as a literal into the tenant folder, which is all Next can follow', () => {
    const rendered = renderHqTenantRegistry(['brand-a', 'brand-b']);
    const specifiers = [...rendered.matchAll(/from '([^']+)'/g)].map((match) => match[1] ?? '');
    assert.deepEqual(specifiers, [
      '../../../tenants/brand-a/brand.json',
      '../../../tenants/brand-a/modules.json',
      '../../../tenants/brand-b/brand.json',
      '../../../tenants/brand-b/modules.json',
    ]);
    assert.doesNotMatch(rendered, /require\(|import\(/);
  });

  it('writes the registry, and leaves it untouched when nothing changed', () => {
    const root = fixtureRoot();
    seedTenant(root, 'brand-a');
    assert.equal(writeHqTenantRegistry(root).changed, true);
    assert.equal(writeHqTenantRegistry(root).changed, false);

    seedTenant(root, 'brand-b');
    const second = writeHqTenantRegistry(root);
    assert.equal(second.changed, true);
    assert.deepEqual(second.slugs, ['brand-a', 'brand-b']);
    assert.equal(
      readFileSync(join(root, HQ_TENANT_REGISTRY), 'utf8'),
      renderHqTenantRegistry(['brand-a', 'brand-b']),
    );
  });
});

describe('this checkout', () => {
  it('commits the registry the generator would write for its tenants/ folder', () => {
    const committed = readFileSync(join(ROOT, HQ_TENANT_REGISTRY), 'utf8');
    assert.equal(
      committed,
      renderHqTenantRegistry(hqTenantSlugs(ROOT)),
      `${HQ_TENANT_REGISTRY} does not match tenants/: a tenant folder was added, removed or `
      + 'renamed without regenerating it. Run `pnpm hq:tenants` and commit the result.',
    );
  });

  it('lists real tenants, so the comparison above cannot pass by finding none', () => {
    const slugs = hqTenantSlugs(ROOT);
    assert.ok(slugs.includes('coffee-story') && slugs.length >= 5, `found only ${slugs.join(', ')}`);
    assert.equal(slugs.includes('_template'), false);
  });

  it('names a regenerate command in the generated header that really exists', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    assert.equal(manifest.scripts['hq:tenants'], 'tsx scripts/hq-tenant-registry.ts');
    assert.match(renderHqTenantRegistry([]), /`pnpm hq:tenants`/);
  });
});
