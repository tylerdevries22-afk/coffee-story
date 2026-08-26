import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { MenuTree } from '@platform/data';

import { catalogAddOns, customerCatalogFromTree } from './live-catalog';

const TREE = {
  menuId: 'menu',
  drops: [],
  categories: [{
    id: 'category-id', brand_id: 'brand', menu_id: 'menu', title: 'Coffee & Espresso',
    tagline: 'Pulled with care', sort_order: 0, created_at: '2026-01-01',
    items: [{
      id: 'item-id', brand_id: 'brand', menu_id: 'menu', category_id: 'category-id',
      slug: 'latte', name: 'House Latte', description: 'Espresso and milk.',
      image_url: 'https://assets.example.com/latte.webp', base_price_cents: 500,
      sizes: [{ slug: '12', label: '12 oz', price_cents: 500 }],
      modifiers: [{ id: 'milk', name: 'Milk', select: 'single', required: false, maxChoices: 1, choices: [{ id: 'oat', name: 'Oat', priceDeltaCents: 75 }] }],
      availability: {}, is_86d: false, is_listed: true, sort_order: 0,
      rotation: 'permanent', weekday: null, pack_size: null, choice_source: null,
      single_item_id: null, pack_choice_slugs: [], created_at: '2026-01-01', updated_at: '2026-01-01',
    }],
  }],
} satisfies MenuTree;

describe('live customer catalog', () => {
  it('projects the canonical database row with its remote picture and ordering slugs', () => {
    const catalog = customerCatalogFromTree(
      TREE,
      [{ id: 'coffee', title: 'Coffee & Espresso', tagline: '' }],
      { latte: 42 },
    );
    assert.equal(catalog.categories[0]?.id, 'coffee');
    assert.equal(catalog.items[0]?.name, 'House Latte');
    assert.deepEqual(catalog.items[0]?.image, { uri: 'https://assets.example.com/latte.webp', fallback: 42 });
    assert.equal(catalog.items[0]?.sizes[0]?.slug, 'latte-12');
    assert.equal(catalog.addOns[0]?.slug, 'oat');
  });

  it('deduplicates paid choices across menu items', () => {
    const catalog = customerCatalogFromTree(TREE, [], {});
    assert.equal(catalogAddOns([...catalog.items, ...catalog.items]).length, 1);
  });
});
