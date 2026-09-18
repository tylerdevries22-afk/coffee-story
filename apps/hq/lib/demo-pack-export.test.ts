import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { demoPackExport } from './demo-pack-export';

const VALID_BRAND = {
  schemaVersion: 1,
  organization: { kind: 'independent' },
  network: null,
  inheritance: { mode: 'standalone', sourceTenantSlug: null, revision: 1, overrides: [] },
  surfaces: ['customer', 'kiosk'],
  providers: [],
  identity: {
    slug: 'harbor-roast', name: 'Harbor Roast', bundleId: 'com.harborroast.app', scheme: 'harborroast',
    kioskBundleId: 'com.harborroast.kiosk', kioskScheme: 'harborroast-kiosk', easProjectId: '', kioskEasProjectId: '',
  },
  tokens: { primary: '#1A2B3C' },
  copy: { appName: 'Harbor Roast' },
  features: { drops: false },
};

const VALID_MENU = {
  categories: [{ id: 'coffee', title: 'Coffee' }],
  items: [{
    id: 'latte', name: 'Latte', description: 'Steamed milk.', category: 'coffee',
    sizes: [{ slug: 'small', priceCents: 425 }],
  }],
};

const VALID_MODULES = { schemaVersion: 1, modules: [{ key: 'commerce-catalog', version: '1.0.0', enabled: true }] };

const BUILDER = { name: 'Acme Digital', contactHref: 'mailto:hello@example.com' };

function baseInput(overrides: { pack?: Record<string, unknown> } = {}) {
  return {
    pack: { brand: VALID_BRAND, menu: VALID_MENU, modules: VALID_MODULES, media: {}, ...overrides.pack },
    businessName: 'Harbor Roast',
    token: 'a'.repeat(43),
    builder: BUILDER,
    expiresAt: '2026-10-01T00:00:00.000Z',
  };
}

describe('demoPackExport', () => {
  it('assembles a well-formed pack for the guest apps', () => {
    const result = demoPackExport(baseInput());
    assert.ok(result);
    assert.equal(result.version, 1);
    assert.equal(result.businessName, 'Harbor Roast');
    assert.deepEqual(result.brand, VALID_BRAND);
    assert.equal(result.menu.items.length, 1);
    assert.deepEqual(result.menu.items[0]?.optionGroups, []);
    assert.equal(result.menu.items[0]?.sizes[0]?.priceCents, 425);
    assert.deepEqual(result.modules, VALID_MODULES);
    assert.equal(result.builder.name, 'Acme Digital');
    assert.equal(result.removeHref, `/d/${'a'.repeat(43)}/remove`);
    assert.equal(result.expiresAt, '2026-10-01T00:00:00.000Z');
  });

  it('always emits optionGroups: [] even when the source item declares its own', () => {
    const result = demoPackExport(baseInput({
      pack: {
        menu: {
          categories: VALID_MENU.categories,
          items: [{ ...VALID_MENU.items[0], optionGroups: [{ id: 'size', name: 'Size' }] }],
        },
      },
    }));
    assert.deepEqual(result?.menu.items[0]?.optionGroups, []);
  });

  it('rejects a pack whose brand does not pass parseTenantManifest', () => {
    const result = demoPackExport(baseInput({ pack: { brand: { ...VALID_BRAND, identity: undefined } } }));
    assert.equal(result, null);
  });

  it('rejects a pack whose modules do not pass parseTenantModulesManifest', () => {
    const result = demoPackExport(baseInput({ pack: { modules: { schemaVersion: 'nope' } } }));
    assert.equal(result, null);
  });

  it('rejects a menu with no categories or no items', () => {
    assert.equal(demoPackExport(baseInput({ pack: { menu: { categories: [], items: VALID_MENU.items } } })), null);
    assert.equal(demoPackExport(baseInput({ pack: { menu: { categories: VALID_MENU.categories, items: [] } } })), null);
  });

  it('drops an item with no id or no name rather than failing the whole pack', () => {
    const result = demoPackExport(baseInput({
      pack: {
        menu: {
          categories: VALID_MENU.categories,
          items: [VALID_MENU.items[0], { id: 'no-name' }, { name: 'No id' }],
        },
      },
    }));
    assert.equal(result?.menu.items.length, 1);
  });

  it('drops a size with a negative, fractional, or unnamed price', () => {
    const result = demoPackExport(baseInput({
      pack: {
        menu: {
          categories: VALID_MENU.categories,
          items: [{
            id: 'mixed', name: 'Mixed sizes', category: 'coffee',
            sizes: [
              { slug: 'small', priceCents: 300 },
              { slug: 'negative', priceCents: -100 },
              { slug: 'fractional', priceCents: 1.5 },
              { priceCents: 400 },
            ],
          }],
        },
      },
    }));
    assert.deepEqual(result?.menu.items[0]?.sizes, [{ slug: 'small', priceCents: 300 }]);
  });

  it('defaults a missing description or category to an empty string, never null or undefined', () => {
    const result = demoPackExport(baseInput({
      pack: { menu: { categories: VALID_MENU.categories, items: [{ id: 'plain', name: 'Plain' }] } },
    }));
    assert.equal(result?.menu.items[0]?.description, '');
    assert.equal(result?.menu.items[0]?.category, '');
  });

  it('admits a media reference only through the demo media proxy path', () => {
    const result = demoPackExport(baseInput({
      pack: { media: { logo: 'logo.webp', items: { latte: 'latte.webp', ghost: '../../etc/passwd.png' } } },
    }));
    assert.equal(result?.media.logo, '/d/media/logo.webp');
    assert.deepEqual(result?.media.items, { latte: '/d/media/latte.webp' });
  });

  it('reports no media rather than throwing when the pack has none', () => {
    const result = demoPackExport(baseInput({ pack: { media: undefined } }));
    assert.deepEqual(result?.media, { logo: null, items: {} });
  });

  it('bounds an oversized menu instead of shipping it whole', () => {
    const categories = Array.from({ length: 60 }, (_, index) => ({ id: `c${index}`, title: `Group ${index}` }));
    const items = Array.from({ length: 400 }, (_, index) => ({
      id: `item-${index}`, name: `Item ${index}`, category: 'c0',
      sizes: Array.from({ length: 10 }, (__, sizeIndex) => ({ slug: `s${sizeIndex}`, priceCents: sizeIndex * 100 })),
    }));
    const result = demoPackExport(baseInput({ pack: { menu: { categories, items } } }));
    assert.equal(result?.menu.categories.length, 40);
    assert.equal(result?.menu.items.length, 300);
    assert.equal(result?.menu.items[0]?.sizes.length, 6);
  });

  it('rejects a non-object pack rather than throwing', () => {
    for (const pack of [null, 'nope', 42, []]) {
      assert.equal(demoPackExport({ ...baseInput(), pack }), null);
    }
  });
});
