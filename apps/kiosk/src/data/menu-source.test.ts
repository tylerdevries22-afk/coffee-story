import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { optionGroupsFor } from '@platform/domain';

import { demoMenu, optionCategoryIdFor } from './menu-source';

describe('optionCategoryIdFor', () => {
  it('keeps database category titles compatible with the option engine', () => {
    const item = demoMenu().items.find((candidate) => candidate.id === 'tiramisu-latte');
    assert.ok(item);
    const categoryId = optionCategoryIdFor(item);
    assert.equal(categoryId, 'signature');
    assert.ok(categoryId && optionGroupsFor(item.id, categoryId).some((group) => group.id === 'serve'));
  });

  it('fails closed for a tenant category with no option contract', () => {
    assert.equal(optionCategoryIdFor({ categoryId: 'Seasonal Specials' }), null);
  });
});
