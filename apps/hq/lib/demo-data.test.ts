import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import coffeeStoryMenu from '../../customer/src/tenants/coffee-story/menu.json';

import { DEMO_KIOSK_MENU } from './demo-data';

describe('Coffee Story kiosk demo media', () => {
  it('uses the complete customer menu and a managed thumbnail for every item', () => {
    assert.equal(DEMO_KIOSK_MENU.itemSlugs.length, coffeeStoryMenu.items.length);
    assert.equal(Object.keys(DEMO_KIOSK_MENU.imageUrls).length, coffeeStoryMenu.items.length);
    for (const item of coffeeStoryMenu.items) {
      assert.equal(DEMO_KIOSK_MENU.imageUrls[item.id], `/api/demo-media/menu/${item.id}`);
    }
  });
});
