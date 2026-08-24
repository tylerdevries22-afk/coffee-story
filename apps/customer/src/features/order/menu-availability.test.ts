import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isItemSoldOut } from './menu-availability';

describe('isItemSoldOut', () => {
  it('uses fixtures before live availability arrives', () => {
    assert.equal(isItemSoldOut('toast', true, null), true);
  });

  it('lets an authoritative empty set clear an old compiled 86', () => {
    assert.equal(isItemSoldOut('toast', true, new Set()), false);
  });

  it('applies an 86 pushed while the app is already open', () => {
    assert.equal(isItemSoldOut('latte', false, new Set(['latte'])), true);
  });
});
