import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';


const SLOTS = join(__dirname, '..', 'tenants');
const CUSTOMER_SLOTS = join(__dirname, '../../../customer/src/tenants');
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
  it('applies the same tenants as the customer app', () => {
    // Both guest binaries are applied by one `--apply`, so a slug in one and
    // not the other means an interrupted or hand-edited apply.
    const customer = readJson(CUSTOMER_SLOTS, 'applied.json') as { slugs: string[] };
    assert.deepEqual(customer.slugs, [...APPLIED_TENANT_SLUGS]);
  });

  it('is named by the generated barrel, every applied slug of it', () => {
    // The invariant this layout exists for. Metro cannot require a path it
    // computes at runtime, but a barrel that names every path as a literal is
    // fully static -- which is what lets N tenants coexist in one tree.
    // The exported literal itself, not just its declaration: emptying the list
    // while leaving the imports in place is a barrel that compiles, boots, and
    // reports no applied tenant.
    const declared = /APPLIED_TENANT_SLUGS: readonly string\[\] = \[([^\]]*)\]/.exec(BARREL);
    assert.ok(declared, 'the barrel exports no APPLIED_TENANT_SLUGS literal');
    const listed = [...(declared[1] ?? '').matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);
    assert.deepEqual(listed, [...APPLIED_TENANT_SLUGS], 'APPLIED_TENANT_SLUGS disagrees with applied.json');
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
        assert.deepEqual(
          readJson(SLOTS, slug, 'brand.json'),
          readJson(TENANTS, slug, 'brand.json'),
          'run `pnpm onboard --tenant <slug> --apply` to refresh the applied copies',
        );
      });

      it('bundles the same tenant modules.json, which is what capability resolves from', () => {
        // The manifest is the BOOT source for the flow's stored-value gate. A
        // stale copy offers a gift-card tender the tenant no longer installs,
        // or withholds one it does, with no network read that would correct it.
        assert.deepEqual(
          readJson(SLOTS, slug, 'modules.json'),
          readJson(TENANTS, slug, 'modules.json'),
          'run `pnpm onboard --tenant <slug> --apply` to refresh the applied copies',
        );
      });

      it('bundles the same generated menu and media map as the customer app', () => {
        assert.deepEqual(
          readJson(SLOTS, slug, 'menu.json'),
          readJson(CUSTOMER_SLOTS, slug, 'menu.json'),
          'run onboarding with --apply to refresh both offline catalogs',
        );
        assert.equal(
          readFileSync(join(SLOTS, slug, 'menu-media.generated.ts'), 'utf8'),
          readFileSync(join(CUSTOMER_SLOTS, slug, 'menu-media.generated.ts'), 'utf8'),
          'generated static image maps have drifted',
        );
      });

      it('maps every bundled menu item to one statically importable WebP', () => {
        const menu = readJson(SLOTS, slug, 'menu.json') as { items: readonly { id: string }[] };
        const media = readFileSync(join(SLOTS, slug, 'menu-media.generated.ts'), 'utf8');
        const mapped = [...media.matchAll(/^\s*'([^']+)':\s*menu\w+,?$/gm)]
          .map((match) => match[1])
          .filter((item): item is string => item !== undefined)
          .sort();
        assert.deepEqual(mapped, menu.items.map((item) => item.id).sort());
      });

      it('ships this tenant photography byte for byte in both guest apps', () => {
        const source = join(TENANTS, slug, 'assets', 'menu');
        const webps = (directory: string) => readdirSync(directory).filter((f) => f.endsWith('.webp')).sort();
        const expected = webps(source);
        const kiosk = join(__dirname, '../../assets/menu', slug);
        const customer = join(__dirname, '../../../customer/assets/menu', slug);
        assert.deepEqual(webps(kiosk), expected, 'kiosk photograph filenames have drifted from the tenant');
        assert.deepEqual(webps(customer), expected, 'customer photograph filenames have drifted from the tenant');
        for (const filename of expected) {
          const bytes = readFileSync(join(source, filename));
          assert.ok(readFileSync(join(kiosk, filename)).equals(bytes), `${filename} differs in the kiosk bundle`);
          assert.ok(readFileSync(join(customer, filename)).equals(bytes), `${filename} differs in the customer bundle`);
        }
      });
    });
  }
});
