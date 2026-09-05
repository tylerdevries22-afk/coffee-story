import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MENU_ITEMS } from '@/data/catalog';

import { demoMenu } from './menu-source';

describe('demoMenu', () => {
  it('keeps every generated item when its option contract is valid', () => {
    assert.equal(demoMenu().items.length, MENU_ITEMS.length);
  });

  it('carries every generated tenant option contract onto kiosk items', () => {
    const items = demoMenu().items;
    assert.deepEqual(
      items.map((item) => item.optionGroups),
      MENU_ITEMS.map((item) => item.optionGroups),
    );
  });

  it('keeps an explicit empty option contract empty', () => {
    const empty = MENU_ITEMS.find((candidate) => candidate.optionGroups.length === 0);
    assert.ok(empty, 'the selected tenant needs one simple service to cover this path');
    const item = demoMenu().items.find((candidate) => candidate.id === empty.id);
    assert.ok(item);
    assert.deepEqual(item.optionGroups, []);
  });
});
