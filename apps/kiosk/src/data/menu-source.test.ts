import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MENU_ITEMS } from '@/data/catalog';

import { demoMenu } from './menu-source';

describe('demoMenu', () => {
  it('keeps every generated item when its option contract is valid', () => {
    assert.equal(demoMenu().items.length, MENU_ITEMS.length);
  });

  it('carries the generated tenant option groups onto kiosk items', () => {
    const item = demoMenu().items.find((candidate) => candidate.id === 'tiramisu-latte');
    assert.ok(item);
    assert.ok(item.optionGroups.some((group) => group.id === 'serve'));
    assert.ok(item.optionGroups.some((group) => group.id === 'ice'));
  });

  it('keeps an explicit empty option contract empty', () => {
    const item = demoMenu().items.find((candidate) => candidate.id === 'strawberry-nutella-croissant');
    assert.ok(item);
    assert.deepEqual(item.optionGroups, []);
  });
});
