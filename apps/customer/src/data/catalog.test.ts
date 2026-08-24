import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MENU_ADD_ONS } from './catalog-data';

describe('MENU_ADD_ONS', () => {
  it('derives paid add-ons from tenant modifiers without duplicate ids', () => {
    assert.ok(MENU_ADD_ONS.length > 0);
    assert.equal(new Set(MENU_ADD_ONS.map((addOn) => addOn.slug)).size, MENU_ADD_ONS.length);
    assert.ok(MENU_ADD_ONS.every((addOn) => addOn.priceCents > 0));
  });
});
