import assert from 'node:assert/strict';
import test from 'node:test';

import { planImportCategories } from './menu-import-categories';

test('distinct titles receive distinct slugs after normalization collisions', () => {
  assert.deepEqual(planImportCategories(['Cold Brew', 'Cold-Brew'], []), [
    { title: 'Cold Brew', slug: 'cold-brew', sortOrder: 0 },
    { title: 'Cold-Brew', slug: 'cold-brew-2', sortOrder: 1 },
  ]);
});

test('existing titles retain identity and existing slugs remain reserved', () => {
  const existing = [{ id: 'category-1', title: 'Cold Brew', slug: 'cold-brew' }];
  assert.deepEqual(planImportCategories(['Cold Brew', 'Cold-Brew'], existing), [
    { title: 'Cold-Brew', slug: 'cold-brew-2', sortOrder: 1 },
  ]);
});

test('repeated titles produce only one category', () => {
  assert.deepEqual(planImportCategories(['Tea', 'Tea'], []), [
    { title: 'Tea', slug: 'tea', sortOrder: 0 },
  ]);
});
