import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EMPTY_PRODUCT_MEDIA,
  cutoutFeatureLineup,
  resolveProductMedia,
  type ProductMediaCatalog,
} from './product-media';

const SHELF = [
  'matcha-latte',
  'strawberry-matcha',
  'ube-matcha',
  'honey-lavender-matcha',
  'adeni-chai',
  'london-fog',
];

const bundledOnly = (slugs: readonly string[]): ProductMediaCatalog => ({
  bundled: new Set(slugs),
  remote: new Map(),
});

test('a bundled slug resolves to the asset this build ships', () => {
  assert.deepEqual(resolveProductMedia('adeni-chai', bundledOnly(SHELF)), {
    kind: 'bundled',
    slug: 'adeni-chai',
  });
});

test('a slug with no cut-out anywhere is null, never a throw', () => {
  // The photograph path throws at module load for a missing picture, which is
  // right there. Here it would mean a franchise part-way through shooting its
  // menu cannot boot.
  assert.equal(resolveProductMedia('loose-leaf-tea', bundledOnly(SHELF)), null);
  assert.equal(resolveProductMedia('anything', EMPTY_PRODUCT_MEDIA), null);
});

test('a remote url wins over the bundled asset, so a shop can change a picture without a release', () => {
  const catalog: ProductMediaCatalog = {
    bundled: new Set(SHELF),
    remote: new Map([['adeni-chai', 'https://cdn.example/brand/adeni-chai.webp']]),
  };
  assert.deepEqual(resolveProductMedia('adeni-chai', catalog), {
    kind: 'remote',
    slug: 'adeni-chai',
    url: 'https://cdn.example/brand/adeni-chai.webp',
  });
  // Everything without an override keeps shipping from the bundle.
  assert.deepEqual(resolveProductMedia('london-fog', catalog), { kind: 'bundled', slug: 'london-fog' });
});

test('a malformed remote url degrades to the bundled asset rather than to nothing', () => {
  for (const url of ['', '   ', 'menu-images/brand/adeni-chai.webp', 'file:///tmp/x.webp']) {
    const catalog: ProductMediaCatalog = {
      bundled: new Set(SHELF),
      remote: new Map([['adeni-chai', url]]),
    };
    assert.deepEqual(
      resolveProductMedia('adeni-chai', catalog),
      { kind: 'bundled', slug: 'adeni-chai' },
      `"${url}" should not have won`,
    );
  }
});

test('a remote url for a slug with no bundled floor still resolves', () => {
  // This is the case that makes the remote arm worth having: a tenant adds a
  // drink after the binary shipped.
  const catalog: ProductMediaCatalog = {
    bundled: new Set(),
    remote: new Map([['new-drink', 'https://cdn.example/brand/new-drink.webp']]),
  };
  assert.deepEqual(resolveProductMedia('new-drink', catalog), {
    kind: 'remote',
    slug: 'new-drink',
    url: 'https://cdn.example/brand/new-drink.webp',
  });
});

test('the shelf shows six and counts the rest', () => {
  const ten = [...SHELF, 'loose-leaf-tea', 'chai-latte', 'orange-blossom-matcha', 'spanish-matcha'];
  const lineup = cutoutFeatureLineup(ten, bundledOnly(ten), 6);
  assert.equal(lineup.shown.length, 6);
  assert.equal(lineup.remaining, 4);
  assert.deepEqual(lineup.shown, ten.slice(0, 6));
});

test('items with no cut-out are not shown and not counted as remaining', () => {
  // They are not part of this shelf at all -- the see-all link counts drinks
  // that were held back, not drinks that have no picture.
  const ten = [...SHELF, 'loose-leaf-tea', 'chai-latte', 'orange-blossom-matcha', 'spanish-matcha'];
  const lineup = cutoutFeatureLineup(ten, bundledOnly(SHELF), 6);
  assert.deepEqual(lineup.shown, SHELF);
  assert.equal(lineup.remaining, 0);
});

test('a tenant part-way through shooting its menu gets a shorter shelf, not a broken one', () => {
  const lineup = cutoutFeatureLineup(SHELF, bundledOnly(['matcha-latte', 'adeni-chai']), 6);
  assert.deepEqual(lineup.shown, ['matcha-latte', 'adeni-chai']);
  assert.equal(lineup.remaining, 0);
});

test('the declared order is the running order, because the rows alternate off the index', () => {
  const reversed = [...SHELF].reverse();
  assert.deepEqual(cutoutFeatureLineup(reversed, bundledOnly(SHELF), 6).shown, reversed);
});

test('a nonsense limit cannot produce a nonsense shelf', () => {
  assert.deepEqual(cutoutFeatureLineup(SHELF, bundledOnly(SHELF), 0), { shown: [], remaining: 6 });
  assert.deepEqual(cutoutFeatureLineup(SHELF, bundledOnly(SHELF), -3), { shown: [], remaining: 6 });
  assert.equal(cutoutFeatureLineup(SHELF, bundledOnly(SHELF), 99).remaining, 0);
});
