import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DropRow, MenuCategoryRow, MenuItemRow } from '@platform/schema';

import { resolveKioskFlow } from './kiosk-flow';
import {
  dropVisibility, itemsInCategoryOf, kioskMenuFromRows, menuFactsFrom,
  packChoicesOf, packsInCategoryOf, parseSizes,
} from './kiosk-menu';
import { sizeLabel } from './sizes';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-08-23T18:00:00.000Z');

function category(over: Partial<MenuCategoryRow> = {}): MenuCategoryRow {
  return {
    id: 'cat-1', brand_id: 'b', menu_id: 'm', title: 'Espresso',
    tagline: 'Pulled with care', sort_order: 0, created_at: '', ...over,
  };
}

function item(over: Partial<MenuItemRow> = {}): MenuItemRow {
  return {
    id: 'i-1', brand_id: 'b', menu_id: 'm', category_id: 'cat-1', slug: 'cortado',
    name: 'Cortado', description: '', image_url: null, base_price_cents: 450,
    sizes: [], modifiers: [], availability: {}, is_86d: false, is_listed: true,
    sort_order: 0, rotation: 'permanent', weekday: null, pack_size: null,
    choice_source: null, single_item_id: null, created_at: '', updated_at: '',
    ...over,
  };
}

function drop(over: Partial<DropRow> = {}): DropRow {
  return {
    id: 'd-1', brand_id: 'b', item_id: 'i-1', reveal_at: null,
    starts_at: new Date(NOW - HOUR).toISOString(),
    ends_at: new Date(NOW + HOUR).toISOString(),
    status: 'live', hero_asset_url: null, created_at: '', updated_at: '', ...over,
  };
}

describe('parseSizes', () => {
  // The seed writes exactly this. Reading `price_cents` as `priceCents` yields
  // undefined and prices the whole live menu at $0.00 without erroring, so the
  // stored spelling is pinned here rather than assumed.
  it('reads the shape the database actually stores', () => {
    const sizes = parseSizes(
      [{ slug: '12', label: '12 oz', price_cents: 550 }, { slug: '16', label: '16 oz', price_cents: 625 }],
      550,
    );
    assert.deepEqual(sizes.map((s) => s.priceCents), [550, 625]);
    assert.deepEqual(sizes.map(sizeLabel), ['12 oz', '16 oz']);
  });

  it('still reads a compiled catalog size', () => {
    const sizes = parseSizes([{ slug: 'latte-12', ounces: 12, priceCents: 550 }], 550);
    assert.deepEqual(sizes, [{ slug: 'latte-12', priceCents: 550, ounces: 12 }]);
  });

  // A bare numeric slug has no `-12` suffix, so sizeLabelFor calls it "Each".
  it('labels a bare numeric slug by volume, not "Each"', () => {
    assert.equal(sizeLabel(parseSizes([{ slug: '12', price_cents: 550 }], 550)[0]!), '12 oz');
  });

  it('synthesises one size for an item that has none', () => {
    assert.deepEqual(parseSizes([], 525), [{ slug: 'each', priceCents: 525 }]);
  });

  it('drops an entry with no usable price rather than selling it for nothing', () => {
    assert.deepEqual(parseSizes([{ slug: '12' }, { slug: '16', price_cents: 625 }], 0),
      [{ slug: '16', priceCents: 625, ounces: 16 }]);
  });

  it('survives junk where an array belongs', () => {
    assert.deepEqual(parseSizes('not an array', 400), [{ slug: 'each', priceCents: 400 }]);
    assert.deepEqual(parseSizes([null, 7, { label: 'no slug' }], 0), []);
  });
});

describe('kioskMenuFromRows', () => {
  it('keys items by slug and categories by title', () => {
    const menu = kioskMenuFromRows({
      categories: [category()], items: [item()], drops: [],
    });
    assert.deepEqual(menuFactsFrom(menu), {
      categories: [{ id: 'Espresso', title: 'Espresso' }],
      itemSlugs: ['cortado'],
    });
    assert.equal(itemsInCategoryOf(menu, 'Espresso').length, 1);
  });

  it('resolves a pack single from uuid to slug', () => {
    const menu = kioskMenuFromRows({
      categories: [category()],
      items: [
        item(),
        item({ id: 'i-2', slug: 'six-pack', name: 'Six Pack', pack_size: 6, choice_source: 'lineup', single_item_id: 'i-1' }),
      ],
      drops: [],
    });
    const pack = packsInCategoryOf(menu, 'Espresso')[0];
    assert.equal(pack?.singleItemId, 'cortado');
  });

  it('loses the badge rather than the pack when the single is delisted', () => {
    const menu = kioskMenuFromRows({
      categories: [category()],
      items: [item({ id: 'i-2', slug: 'six-pack', pack_size: 6, choice_source: 'lineup', single_item_id: 'gone' })],
      drops: [],
    });
    assert.equal(packsInCategoryOf(menu, 'Espresso').length, 1);
    assert.equal(packsInCategoryOf(menu, 'Espresso')[0]?.singleItemId, undefined);
  });

  it('drops an item whose category did not come back', () => {
    const menu = kioskMenuFromRows({
      categories: [category()], items: [item({ category_id: 'missing' })], drops: [],
    });
    assert.deepEqual(menu.items, []);
  });

  it('drops a drop with an unparseable window', () => {
    const menu = kioskMenuFromRows({
      categories: [category()], items: [item()], drops: [drop({ starts_at: 'soon' })],
    });
    assert.deepEqual(menu.drops, []);
  });
});

describe('dropVisibility', () => {
  const base = { itemId: 'cortado', status: 'live' as const, revealAt: null, startsAt: NOW - HOUR, endsAt: NOW + HOUR };

  it('mirrors every branch of app.drop_visibility', () => {
    assert.equal(dropVisibility({ ...base, status: 'draft' }, NOW), 'hidden');
    assert.equal(dropVisibility({ ...base, status: 'cancelled' }, NOW), 'hidden');
    assert.equal(dropVisibility(base, NOW), 'orderable');
    assert.equal(dropVisibility({ ...base, endsAt: NOW - 1 }, NOW), 'ended');
    assert.equal(dropVisibility({ ...base, startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR, revealAt: NOW - 1 }, NOW), 'revealed');
    assert.equal(dropVisibility({ ...base, startsAt: NOW + HOUR, endsAt: NOW + 2 * HOUR }, NOW), 'hidden');
  });

  // The SQL is `at_time < d.ends_at`, so the closing instant is already ended.
  it('closes on the ends_at instant, as the SQL does', () => {
    assert.equal(dropVisibility({ ...base, endsAt: NOW }, NOW), 'ended');
    assert.equal(dropVisibility({ ...base, startsAt: NOW }, NOW), 'orderable');
  });
});

describe('packChoicesOf', () => {
  const menu = kioskMenuFromRows({
    categories: [category()],
    items: [
      item({ id: 'i-1', slug: 'permanent-one' }),
      item({ id: 'i-2', slug: 'rotating-live', rotation: 'rotating' }),
      item({ id: 'i-3', slug: 'rotating-dark', rotation: 'rotating' }),
      item({ id: 'i-4', slug: 'eighty-sixed', is_86d: true }),
      item({ id: 'i-5', slug: 'a-pack', pack_size: 6, choice_source: 'lineup' }),
    ],
    drops: [drop({ item_id: 'i-2' })],
  });

  // The compiled version took `pack` and ignored it, so these two were equal
  // and the choice_source column expressed nothing.
  it('narrows a lineup pack to permanent plus what is orderable now', () => {
    const slugs = packChoicesOf(menu, { packSize: 6, choiceSource: 'lineup' }, NOW).map((i) => i.id);
    assert.deepEqual(slugs, ['permanent-one', 'rotating-live']);
  });

  it('offers a static pack every single', () => {
    const slugs = packChoicesOf(menu, { packSize: 6, choiceSource: 'static' }, NOW).map((i) => i.id);
    assert.deepEqual(slugs, ['permanent-one', 'rotating-live', 'rotating-dark']);
  });

  it('never offers a pack inside a pack, or an 86d item', () => {
    for (const source of ['lineup', 'static'] as const) {
      const slugs = packChoicesOf(menu, { packSize: 6, choiceSource: source }, NOW).map((i) => i.id);
      assert.ok(!slugs.includes('a-pack'));
      assert.ok(!slugs.includes('eighty-sixed'));
    }
  });

  it('drops a rotating item back out when its window closes', () => {
    const later = NOW + 2 * HOUR;
    const slugs = packChoicesOf(menu, { packSize: 6, choiceSource: 'lineup' }, later).map((i) => i.id);
    assert.deepEqual(slugs, ['permanent-one']);
  });
});

describe('a franchise onboarded this morning', () => {
  // The zero-config path, and the regression that matters most: the entry
  // constellation is DERIVED from the tenant's own categories, so a shop that
  // has never opened the HQ tab still opens on something a guest can press.
  // An earlier build gated the first screen on a measurement that never
  // arrived and shipped an empty room; this asserts the data reaches it.
  it('opens on a pressable screen with no kiosk config at all', () => {
    const menu = kioskMenuFromRows({
      categories: [
        category({ id: 'c1', title: 'Espresso', sort_order: 0 }),
        category({ id: 'c2', title: 'Brew Bar', sort_order: 1 }),
      ],
      items: [
        item({ id: 'i1', category_id: 'c1', slug: 'cortado' }),
        item({ id: 'i2', category_id: 'c2', slug: 'v60', sizes: [{ slug: '10', label: '10 oz', price_cents: 600 }] }),
      ],
      drops: [],
    });
    const flow = resolveKioskFlow(undefined, { menu: menuFactsFrom(menu) });
    assert.deepEqual(flow.entry.nodes.map((node) => node.label), ['Espresso', 'Brew Bar']);
    // Every node has somewhere to go, or the screen is decoration.
    for (const node of flow.entry.nodes) {
      assert.equal(node.target.kind, 'category');
      assert.ok(itemsInCategoryOf(menu, node.label).length > 0, `${node.label} has no items`);
    }
  });

  it('derives nothing rather than guessing when the menu has not loaded', () => {
    const flow = resolveKioskFlow(undefined, { menu: menuFactsFrom(kioskMenuFromRows({
      categories: [], items: [], drops: [],
    })) });
    assert.deepEqual(flow.entry.nodes, []);
  });
});
