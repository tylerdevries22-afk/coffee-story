import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  defaultSizeSlug,
  menuPriceLabel,
  sizeLabelFor,
  sizePriceCents,
  type CatalogSize,
} from './sizes';

const size = (slug: string, ounces: number, dollars: number): CatalogSize => (
  { slug, ounces, priceCents: dollars * 100 }
);

describe('sizeLabelFor', () => {
  it('reads ounces off a drink slug', () => {
    assert.equal(sizeLabelFor('latte-12'), '12 oz');
    assert.equal(sizeLabelFor('honey-lavender-latte-20'), '20 oz');
  });

  it('reads the named portions off a food slug', () => {
    assert.equal(sizeLabelFor('turkish-coffee-single'), 'Single');
    assert.equal(sizeLabelFor('turkish-coffee-double'), 'Double');
    assert.equal(sizeLabelFor('mochi-donut-trio'), 'Trio');
    assert.equal(sizeLabelFor('milk-cake-slice'), 'Slice');
  });

  it('falls back to Each for a single-serve item', () => {
    assert.equal(sizeLabelFor('grilled-cheese'), 'Each');
    assert.equal(sizeLabelFor('espresso'), 'Each');
  });

  it('reads the trailing number, not a number in the middle of the slug', () => {
    // The end anchor in the pattern is the whole point. Without it a slug with
    // an internal number would be labelled by that number, and the label goes
    // straight onto the bag row and the barista's ticket.
    assert.equal(sizeLabelFor('ade-2-for-1-16'), '16 oz');
    assert.equal(sizeLabelFor('sandwich-6-inch'), 'Each');
    assert.equal(sizeLabelFor('boba-milk-tea'), 'Each');
  });
});

describe('sizePriceCents', () => {
  it('converts whole catalog dollars to cents', () => {
    assert.equal(sizePriceCents(size('latte-16', 16, 5)), 500);
  });

  it('never returns a negative price', () => {
    assert.equal(sizePriceCents(size('broken', 1, -3)), 0);
  });
});

describe('menuPriceLabel', () => {
  it('prints one price outright', () => {
    assert.equal(menuPriceLabel([size('grilled-cheese', 1, 7)]), '$7');
  });

  it('prints the cheapest as a "from" when a tap opens a size picker', () => {
    assert.equal(
      menuPriceLabel([size('latte-12', 12, 4), size('latte-16', 16, 5), size('latte-20', 20, 6)]),
      'from $4',
    );
  });

  it('says nothing for an item with no sizes at all', () => {
    assert.equal(menuPriceLabel([]), '');
  });
});

describe('defaultSizeSlug', () => {
  it('opens a three-size drink on the middle size', () => {
    assert.equal(
      defaultSizeSlug([size('latte-12', 12, 4), size('latte-16', 16, 5), size('latte-20', 20, 6)]),
      'latte-16',
    );
  });

  it('opens a two-size item on the smaller one', () => {
    assert.equal(defaultSizeSlug([size('boba-16', 16, 6), size('boba-20', 20, 7)]), 'boba-16');
  });

  it('opens a single-size item on its only size', () => {
    assert.equal(defaultSizeSlug([size('grilled-cheese', 1, 7)]), 'grilled-cheese');
  });

  it('returns an empty slug rather than throwing on an empty list', () => {
    assert.equal(defaultSizeSlug([]), '');
  });
});
