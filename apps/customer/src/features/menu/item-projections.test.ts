import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupOrderableItems, projectFirstVariants, projectItem, projectItems } from './item-projections';

const source = {
  id: 'latte',
  name: 'Latte',
  description: 'Espresso with steamed milk and foam.',
  image: 1,
  category: 'coffee',
  sizes: [{ slug: 'latte-12', ounces: 12, priceCents: 400 }, { slug: 'latte-16', ounces: 16, priceCents: 500 }],
} as const;

test('projects every catalog size into integer cents', () => {
  assert.deepEqual(projectItems([source]).map((item) => [item.slug, item.priceCents]), [
    ['latte-12', 400], ['latte-16', 500],
  ]);
});

test('an item with no sizes receives the safe fallback shape', () => {
  const noSizes = { ...source, sizes: [] as const };
  assert.deepEqual(projectItem(noSizes), {
    slug: 'latte', name: 'Latte', category: 'specialty', ounces: undefined, durationMin: 5,
    priceCents: 0, depositCents: 0, description: 'Espresso with steamed milk and foam.',
  });
});

test('the account and staff projections keep one item-level slug', () => {
  assert.deepEqual(projectFirstVariants([source]).map((item) => item.slug), ['latte']);
});

test('grouping preserves service order and uses the first session image', () => {
  const services = projectItems([source]);
  const groups = groupOrderableItems(services, (slug) => slug.endsWith('12') ? 7 : 9);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.image, 7);
  assert.deepEqual(groups[0]?.variants.map((item) => item.slug), ['latte-12', 'latte-16']);
});
