import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';


const SLOTS = join(__dirname, '..', 'tenants');
const TENANTS = join(__dirname, '../../../../tenants');

function readJson(...segments: string[]): unknown {
  return JSON.parse(readFileSync(join(...segments), 'utf8'));
}

/** What `--apply` recorded, and what `app.config.ts` reads. */
const APPLIED_TENANT_SLUGS: readonly string[] = (readJson(SLOTS, 'applied.json') as { slugs: string[] }).slugs;

/** The generated barrel, read as text so no tenant has to be selected. */
const BARREL = readFileSync(join(SLOTS, 'index.ts'), 'utf8');

/**
 * The applied tenant slots, asserted without selecting one.
 *
 * Deliberately free of any import from `./index`: that barrel picks a tenant at
 * module load and throws when several are applied and `EXPO_PUBLIC_TENANT` is
 * unset, which is exactly the behaviour we want everywhere else. Reading the
 * tree instead means the drift guard for N tenants runs with no environment at
 * all, so `pnpm test` keeps working the moment franchisee #2 is applied.
 *
 * The app used to bundle a single shared `src/tenant/brand.json` that
 * `--apply` overwrote, so a second brand could not exist in the tree: applying
 * B deleted A's build inputs, and A's released binary stopped being
 * reproducible from any commit.
 */
describe('applied tenant slots', () => {
  it('applies at least one tenant and names each one exactly once', () => {
    assert.ok(APPLIED_TENANT_SLUGS.length >= 1, 'no tenant is applied');
    assert.deepEqual([...APPLIED_TENANT_SLUGS], [...new Set(APPLIED_TENANT_SLUGS)]);
    assert.deepEqual([...APPLIED_TENANT_SLUGS], [...APPLIED_TENANT_SLUGS].sort());
  });

  it('is named by the generated barrel, every applied slug of it', () => {
    // The invariant this layout exists for. Metro cannot require a path it
    // computes at runtime, but a barrel that names every path as a literal is
    // fully static -- which is what lets N tenants coexist in one tree.
    assert.match(BARREL, /APPLIED_TENANT_SLUGS: readonly string\[\] = \[/);
    for (const slug of APPLIED_TENANT_SLUGS) {
      assert.match(BARREL, new RegExp(`from './${slug}/brand\\.json'`), `the barrel omits ${slug}`);
      assert.match(BARREL, new RegExp(`'${slug}': \\{`), `SLOTS omits ${slug}`);
    }
    const named = [...BARREL.matchAll(/^  '([a-z0-9-]+)': \{$/gm)].map((match) => match[1]);
    assert.deepEqual(named, [...APPLIED_TENANT_SLUGS], 'the barrel names a tenant that is not applied');
  });

  it('names every directory in the slot, and no directory it does not have', () => {
    const directories = readdirSync(SLOTS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(directories, [...APPLIED_TENANT_SLUGS]);
  });


  for (const slug of APPLIED_TENANT_SLUGS) {
    describe(slug, () => {
      it('matches tenants/<slug>/brand.json exactly', () => {
        // Onboarding materialises the choice (Metro cannot require a
        // runtime-computed path); a drifted copy ships the wrong brand.
        assert.deepEqual(readJson(SLOTS, slug, 'brand.json'), readJson(TENANTS, slug, 'brand.json'));
      });

      it('is applied under the slug its own brand file claims', () => {
        const brand = readJson(SLOTS, slug, 'brand.json') as { identity: { slug: string } };
        assert.equal(brand.identity.slug, slug);
      });

      it('bundles the same tenant modules.json, which is what capability resolves from', () => {
        // The manifest is the BOOT source for tenantFeature. A stale copy is a
        // binary offering a capability its tenant no longer installs, or hiding
        // one it does -- with no network read that would correct either.
        assert.deepEqual(readJson(SLOTS, slug, 'modules.json'), readJson(TENANTS, slug, 'modules.json'));
      });

      it('maps every menu item to one statically importable photograph', () => {
        // Read as text: menu-media.ts imports .webp, which node:test cannot
        // transform. `catalog.ts` throws on a menu item with no bundled image,
        // so a partial map is a crash on the first menu render.
        const media = readFileSync(join(SLOTS, slug, 'menu-media.generated.ts'), 'utf8');
        const mapped = [...media.matchAll(/^\s*'([^']+)':\s*menu\w+,?$/gm)].map((match) => match[1]).sort();
        const menu = readJson(SLOTS, slug, 'menu.json') as { items: readonly { id: string }[] };
        assert.deepEqual(mapped, menu.items.map((item) => item.id).sort());
      });

      it('imports every photograph from its own slug directory', () => {
        // The reason the assets are keyed by slug at all: two tenants can name
        // the same item (`cortado` is on two shipped menus), so a flat
        // directory is a byte collision between brands, not just untidy.
        const media = readFileSync(join(SLOTS, slug, 'menu-media.generated.ts'), 'utf8');
        for (const match of media.matchAll(/from '([^']+)'/g)) {
          assert.match(match[1] ?? '', new RegExp(`/assets/menu/${slug}/`));
        }
      });

      it('ships the tenant menu photographs byte for byte', () => {
        const source = join(TENANTS, slug, 'assets', 'menu');
        const bundled = join(__dirname, '../../assets/menu', slug);
        const webps = (directory: string) => readdirSync(directory).filter((f) => f.endsWith('.webp')).sort();
        assert.deepEqual(webps(bundled), webps(source), 'stale or missing tenant photographs');
        for (const file of webps(source)) {
          assert.ok(
            readFileSync(join(bundled, file)).equals(readFileSync(join(source, file))),
            `menu/${slug}/${file} has drifted from the tenant folder`,
          );
        }
      });

      it('maps exactly the product cut-outs the tenant has seated', () => {
        // Unlike the photographs, a missing cut-out is allowed: the shelf is
        // one row shorter. Naming one that is absent fails the bundle.
        const generated = readFileSync(join(SLOTS, slug, 'product-media.generated.ts'), 'utf8');
        const mapped = [...generated.matchAll(/^  '([a-z0-9-]+)':/gm)].map((match) => match[1]).sort();
        const source = join(TENANTS, slug, 'assets', 'products');
        const seated = readdirSync(source)
          .filter((file) => file.endsWith('.webp'))
          .map((file) => file.replace(/\.webp$/, ''))
          .sort();
        assert.deepEqual(mapped, seated);

        const bundled = join(__dirname, '../../assets/products', slug);
        assert.deepEqual(
          readdirSync(bundled).filter((f) => f.endsWith('.webp')).map((f) => f.replace(/\.webp$/, '')).sort(),
          seated,
          'stale cut-outs from another tenant',
        );
        for (const item of seated) {
          const bytes = readFileSync(join(bundled, `${item}.webp`));
          assert.ok(bytes.equals(readFileSync(join(source, `${item}.webp`))), `${item}.webp drifted`);
          // A simple lossy WebP is `VP8 ` and cannot hold an alpha channel; an
          // extended one is `VP8X`. A flattened cut-out still looks plausible
          // in a diff, so the format is asserted rather than trusted.
          assert.equal(bytes.subarray(12, 16).toString('ascii'), 'VP8X', `${item}.webp lost its transparency`);
        }
      });
    });
  }
});
