import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { selectTenantSlot } from '../../../packages/domain/src/tenant-slot.ts';
import { appliedSlugs, GUEST_APPS } from '../../../scripts/onboard-tenant-barrel.ts';
import { applyTenantSlot } from '../../../scripts/onboard-tenant-slots.ts';

const ROOT = join(process.cwd(), '..', '..');

/**
 * The invariant this whole layout exists for: more than one tenant may be
 * applied at once, and the generated barrel names every one of them.
 *
 * Before this, `--apply` copied one tenant's artifacts over shared checked-in
 * files in both guest apps, so onboarding brand B deleted brand A's build
 * inputs -- commit it and A's released binary was no longer reproducible from
 * any commit, refuse to commit and the drift guard failed. A and B could not
 * both be applied, which is what blocked franchisee #2.
 *
 * Asserted against the real generator over a temporary tree, so it proves the
 * shipped code path rather than a description of it.
 */
const temporary: string[] = [];
after(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'tenant-slots-'));
  temporary.push(root);
  for (const app of GUEST_APPS) mkdirSync(join(root, 'apps', app, 'src', 'tenants'), { recursive: true });
  return root;
}

/** A minimal WebP header, enough to be a distinct byte sequence per tenant. */
function fakeWebp(marker: string): Buffer {
  return Buffer.concat([Buffer.from('RIFF....WEBPVP8X'), Buffer.from(marker)]);
}

function seedTenant(root: string, slug: string, items: readonly string[]): string {
  const dir = join(root, 'tenants', slug);
  mkdirSync(join(dir, 'assets', 'menu'), { recursive: true });
  mkdirSync(join(dir, 'assets', 'products'), { recursive: true });
  writeFileSync(join(dir, 'brand.json'), JSON.stringify({ identity: { slug, name: slug } }, null, 2));
  writeFileSync(join(dir, 'modules.json'), JSON.stringify({ modules: [] }, null, 2));
  for (const item of items) {
    writeFileSync(join(dir, 'assets', 'menu', `${item}.webp`), fakeWebp(`${slug}:${item}`));
    writeFileSync(join(dir, 'assets', 'products', `${item}.webp`), fakeWebp(`${slug}:cutout:${item}`));
  }
  return dir;
}

function apply(root: string, slug: string, items: readonly string[]): void {
  applyTenantSlot({
    root,
    slug,
    tenantDir: join(root, 'tenants', slug),
    menuJson: `${JSON.stringify({ categories: [], items: items.map((id) => ({ id })) }, null, 2)}\n`,
    itemSlugs: items,
  });
}

/** Every file under a directory, with its bytes, for an exact before/after. */
function snapshot(directory: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      const key = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(full, key);
      else found.set(key, readFileSync(full).toString('base64'));
    }
  };
  walk(directory, '');
  return found;
}

describe('applying a second tenant', () => {
  it('leaves the first tenant intact, byte for byte', () => {
    const root = fixtureRoot();
    // `cortado` deliberately appears on both menus: two tenants naming the same
    // item is what made a flat asset directory a byte collision between brands.
    seedTenant(root, 'brand-a', ['cortado', 'latte']);
    seedTenant(root, 'brand-b', ['cortado']);

    apply(root, 'brand-a', ['cortado', 'latte']);
    const before = snapshot(join(root, 'apps', 'customer', 'src', 'tenants', 'brand-a'));
    const beforeAssets = snapshot(join(root, 'apps', 'customer', 'assets', 'menu', 'brand-a'));
    assert.ok(before.size > 0 && beforeAssets.size > 0);

    apply(root, 'brand-b', ['cortado']);

    assert.deepEqual(snapshot(join(root, 'apps', 'customer', 'src', 'tenants', 'brand-a')), before);
    assert.deepEqual(snapshot(join(root, 'apps', 'customer', 'assets', 'menu', 'brand-a')), beforeAssets);
  });

  it('is named by the barrel of both guest apps', () => {
    const root = fixtureRoot();
    seedTenant(root, 'brand-a', ['cortado']);
    seedTenant(root, 'brand-b', ['cortado']);
    apply(root, 'brand-a', ['cortado']);
    apply(root, 'brand-b', ['cortado']);

    for (const app of GUEST_APPS) {
      assert.deepEqual(appliedSlugs(root, app), ['brand-a', 'brand-b'], app);
      const slots = join(root, 'apps', app, 'src', 'tenants');
      const barrel = readFileSync(join(slots, 'index.ts'), 'utf8');
      for (const slug of ['brand-a', 'brand-b']) {
        assert.match(barrel, new RegExp(`from './${slug}/brand\\.json'`), `${app} barrel omits ${slug}`);
        assert.match(barrel, new RegExp(`'${slug}': \\{`), `${app} SLOTS omits ${slug}`);
      }
      assert.match(barrel, /APPLIED_TENANT_SLUGS: readonly string\[\] = \['brand-a', 'brand-b'\]/);
      const manifest = JSON.parse(readFileSync(join(slots, 'applied.json'), 'utf8')) as { slugs: string[] };
      assert.deepEqual(manifest.slugs, ['brand-a', 'brand-b'], `${app} applied.json`);
    }
  });

  it('names every path as a literal, which is the only thing Metro requires', () => {
    // Metro cannot `require` a path it computes at runtime. That constraint is
    // what the single shared file was blamed on -- but it says nothing about
    // how MANY literal paths a module may name.
    const root = fixtureRoot();
    seedTenant(root, 'brand-a', ['cortado']);
    seedTenant(root, 'brand-b', ['latte']);
    apply(root, 'brand-a', ['cortado']);
    apply(root, 'brand-b', ['latte']);

    for (const app of GUEST_APPS) {
      const slots = join(root, 'apps', app, 'src', 'tenants');
      for (const file of ['index.ts', 'media.ts']) {
        const contents = readFileSync(join(slots, file), 'utf8');
        for (const specifier of contents.matchAll(/from ('|")([^'"]+)\1/g)) {
          assert.doesNotMatch(specifier[2] ?? '', /\$\{|\+/, `${app}/${file} computes an import path`);
        }
        assert.doesNotMatch(contents, /require\(/, `${app}/${file} uses a dynamic require`);
      }
    }
  });

  it('keeps each tenant photography under its own slug, so identical item names cannot collide', () => {
    const root = fixtureRoot();
    seedTenant(root, 'brand-a', ['cortado']);
    seedTenant(root, 'brand-b', ['cortado']);
    apply(root, 'brand-a', ['cortado']);
    apply(root, 'brand-b', ['cortado']);

    const menu = join(root, 'apps', 'customer', 'assets', 'menu');
    const a = readFileSync(join(menu, 'brand-a', 'cortado.webp'));
    const b = readFileSync(join(menu, 'brand-b', 'cortado.webp'));
    assert.ok(!a.equals(b), 'both tenants kept their own cortado photograph');
    for (const slug of ['brand-a', 'brand-b']) {
      const media = readFileSync(join(root, 'apps', 'customer', 'src', 'tenants', slug, 'menu-media.generated.ts'), 'utf8');
      assert.match(media, new RegExp(`/assets/menu/${slug}/cortado\\.webp`));
    }
  });

  it('is idempotent: re-applying changes nothing', () => {
    const root = fixtureRoot();
    seedTenant(root, 'brand-a', ['cortado']);
    seedTenant(root, 'brand-b', ['latte']);
    apply(root, 'brand-a', ['cortado']);
    apply(root, 'brand-b', ['latte']);
    const before = snapshot(join(root, 'apps'));
    apply(root, 'brand-b', ['latte']);
    apply(root, 'brand-a', ['cortado']);
    assert.deepEqual(snapshot(join(root, 'apps')), before);
  });

  it('refuses to guess which of several applied tenants a build is for', () => {
    const slots = { 'brand-a': { slug: 'brand-a' }, 'brand-b': { slug: 'brand-b' } };
    assert.throws(() => selectTenantSlot({ app: 'customer', slots }), /brand-a, brand-b/);
    assert.equal(selectTenantSlot({ app: 'customer', slots, requested: 'brand-b' }).slug, 'brand-b');
  });
});

describe('this checkout', () => {
  it('applies its tenants additively, with no shared brand file left anywhere', () => {
    for (const app of GUEST_APPS) {
      const applied = appliedSlugs(ROOT, app);
      assert.ok(applied.length >= 1, `apps/${app} has no tenant applied`);
      assert.ok(
        !existsSync(join(ROOT, 'apps', app, 'src', 'tenant', 'brand.json')),
        `apps/${app} still has the shared single-slot brand file`,
      );
      for (const slug of applied) {
        assert.ok(existsSync(join(ROOT, 'apps', app, 'src', 'tenants', slug, 'menu.json')));
        assert.ok(existsSync(join(ROOT, 'apps', app, 'assets', 'menu', slug)));
      }
    }
    assert.deepEqual(appliedSlugs(ROOT, 'customer'), appliedSlugs(ROOT, 'kiosk'));
  });
});
