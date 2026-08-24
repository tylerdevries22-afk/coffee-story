import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CATALOG_ITEMS, MENU_CATEGORY_META } from '../data/catalog-data';
import {
  TEA_MATCHA_CATEGORY,
  TEA_MATCHA_FEATURE_IDS,
  TEA_MATCHA_SHELF_SIZE,
  teaMatchaCount,
  teaMatchaSeeAllLabel,
  teaMatchaShelf,
  teaMatchaTag,
} from './tea-matcha';

test('the shelf is six of the ten, in the declared order', () => {
  const shelf = teaMatchaShelf(CATALOG_ITEMS);
  assert.equal(shelf.length, TEA_MATCHA_SHELF_SIZE);
  assert.deepEqual(shelf.map((item) => item.id), [...TEA_MATCHA_FEATURE_IDS]);
  for (const item of shelf) assert.equal(item.category, TEA_MATCHA_CATEGORY);
});

test('the shelf shows six distinct drinks and never repeats one', () => {
  const ids = teaMatchaShelf(CATALOG_ITEMS).map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a franchise typo costs one row, not the home screen', () => {
  // Same degradation `resolveTokens` applies to a malformed tenant value: drop
  // the field, keep the app.
  const shelf = teaMatchaShelf(CATALOG_ITEMS, ['matcha-latte', 'not-a-drink', 'adeni-chai']);
  assert.deepEqual(shelf.map((item) => item.id), ['matcha-latte', 'adeni-chai']);
});

test('an id from another category is dropped, however real it is', () => {
  // `latte` exists and has a photograph; it is not a tea, and a shelf headed
  // "Tea & Matcha" may not quietly contain one.
  assert.ok(CATALOG_ITEMS.some((item) => item.id === 'latte'));
  assert.deepEqual(teaMatchaShelf(CATALOG_ITEMS, ['latte']), []);
});

test('the see-all link counts the category, and the count is ten', () => {
  const total = teaMatchaCount(CATALOG_ITEMS);
  assert.equal(total, 10);
  assert.match(teaMatchaSeeAllLabel(total), /See all 10/);
  // Four are held back on purpose; the shelf plus the remainder is the category.
  assert.equal(total - TEA_MATCHA_SHELF_SIZE, 4);
});

test('the tag borrows the category tagline rather than inventing a vocabulary', () => {
  const tagline = MENU_CATEGORY_META.find((c) => c.id === TEA_MATCHA_CATEGORY)?.tagline ?? '';
  for (const word of ['Whisked', 'brewed', 'spiced']) {
    assert.ok(tagline.toLowerCase().includes(word.toLowerCase()), `tagline lost "${word}"`);
  }
  assert.equal(teaMatchaTag('strawberry-matcha'), 'Whisked');
  assert.equal(teaMatchaTag('adeni-chai'), 'Spiced');
  assert.equal(teaMatchaTag('london-fog'), 'Brewed');
});

test('every drink on the shelf gets a tag from the tagline, none falls through blank', () => {
  const allowed = new Set(['Whisked', 'Brewed', 'Spiced']);
  for (const item of teaMatchaShelf(CATALOG_ITEMS)) {
    assert.ok(allowed.has(teaMatchaTag(item.id)), `${item.id} produced an off-vocabulary tag`);
  }
});

test('the held-back four are the ones a clear glass serves worst', () => {
  // Recorded so a future edit to the array has to disagree on purpose.
  const shelf = new Set<string>(TEA_MATCHA_FEATURE_IDS);
  const held = CATALOG_ITEMS.filter(
    (item) => item.category === TEA_MATCHA_CATEGORY && !shelf.has(item.id),
  ).map((item) => item.id);
  assert.deepEqual(held.sort(), [
    'chai-latte',
    'loose-leaf-tea',
    'orange-blossom-matcha',
    'spanish-matcha',
  ]);
});
