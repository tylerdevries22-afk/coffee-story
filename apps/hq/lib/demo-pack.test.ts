import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEMO_MEDIA_NAME, demoLanding } from './demo-pack';

const PACK = {
  version: 1,
  brand: {
    identity: { name: 'Harbor Roast' },
    tokens: { primary: '#1A2B3C' },
    business: { tagline: 'Waterfront coffee.', phone: '+1 303 555 0100', website: 'https://harbor.example/' },
    locations: [{ address: { street: '1 Pier Way', city: 'Georgetown', region: 'CO', postal: '80444' } }],
  },
  menu: {
    categories: [{ id: 'coffee', title: 'Coffee' }, { id: 'food', title: 'Food' }],
    items: [
      { id: 'latte', name: 'Latte', description: 'Steamed milk.', category: 'coffee', sizes: [{ priceCents: 525 }] },
      { id: 'scone', name: 'Scone', category: 'food', sizes: [{ priceCents: 400 }] },
      { id: 'mug', name: 'Mug', category: 'merch', sizes: [] },
    ],
  },
  media: { logo: 'logo.webp', items: { latte: 'latte.webp' } },
  listing: {
    mapsUri: 'https://maps.google.com/?cid=1',
    reviewsUri: 'https://www.google.com/maps/place//data=reviews',
    weekdayDescriptions: ['Monday: 7:00 AM – 3:00 PM'],
  },
};

describe('demoLanding', () => {
  it('reads what the landing page draws from a well-formed pack', () => {
    const landing = demoLanding(PACK, 'Harbor Roast');
    assert.equal(landing.name, 'Harbor Roast');
    assert.equal(landing.tagline, 'Waterfront coffee.');
    assert.equal(landing.logo, 'logo.webp');
    assert.equal(landing.address, '1 Pier Way, Georgetown, CO 80444');
    assert.equal(landing.website, 'https://harbor.example/');
    assert.deepEqual(landing.hours, ['Monday: 7:00 AM – 3:00 PM']);
    assert.deepEqual(landing.menu.map((section) => [section.title, section.items.map((item) => item.name)]), [
      ['Coffee', ['Latte']], ['Food', ['Scone']], ['More', ['Mug']],
    ]);
    assert.equal(landing.menu[0]?.items[0]?.priceCents, 525);
    assert.equal(landing.menu[0]?.items[0]?.image, 'latte.webp');
    assert.equal(landing.menu[2]?.items[0]?.priceCents, null, 'an item with no size has no price, not zero');
  });

  // Everything in a pack was scraped, so each of these is an attack the page
  // must render harmlessly rather than a malformed input it may reject.
  it('keeps only https links, safe media names and sane prices', () => {
    const landing = demoLanding({
      brand: { identity: { name: 'X'.repeat(500) }, business: { website: 'javascript:alert(1)' } },
      menu: { items: [
        { id: 'a', name: 'Free', sizes: [{ priceCents: -100 }] },
        { id: 'b', name: 'Fractional', sizes: [{ priceCents: 1.5 }] },
        { id: 'c', name: 'Traversal' },
        { name: 'No id' },
        { id: 'd' },
      ] },
      media: { logo: '../../../etc/passwd.png', items: { c: 'nested/escape.webp' } },
      listing: { mapsUri: 'http://maps.google.com/', reviewsUri: 'https://user:pw@evil.example/' },
    }, 'Fallback');
    assert.ok(landing.name.length <= 120 && landing.name.endsWith('…'));
    assert.equal(landing.website, null);
    assert.equal(landing.mapsUri, null);
    assert.equal(landing.reviewsUri, null);
    assert.equal(landing.logo, null);
    const items = landing.menu.flatMap((section) => section.items);
    assert.deepEqual(items.map((item) => item.name), ['Free', 'Fractional', 'Traversal']);
    assert.deepEqual(items.map((item) => item.priceCents), [null, null, null]);
    assert.equal(items[2]?.image, null);
  });

  it('bounds how much a pack can put on the page', () => {
    const categories = Array.from({ length: 10 }, (_, index) => ({ id: `c${index}`, title: `Group ${index}` }));
    const items = categories.flatMap((category) => Array.from({ length: 20 }, (_, index) => ({
      id: `${category.id}-${index}`, name: `Item ${index}`, category: category.id,
    })));
    const landing = demoLanding({ menu: { categories, items } }, 'Big Menu');
    assert.equal(landing.menu.length, 6);
    assert.ok(landing.menu.every((section) => section.items.length === 8));
  });

  it('falls back to the stored name when a pack has nothing to say', () => {
    for (const pack of [{}, null, 'not a pack', []]) {
      const landing = demoLanding(pack, 'Old Mill Bakery');
      assert.equal(landing.name, 'Old Mill Bakery');
      assert.deepEqual(landing.menu, []);
      assert.equal(landing.address, null);
    }
  });

  it('admits a media name only inside the demo folder', () => {
    for (const good of ['logo.webp', 'latte-1.png', 'item_2.jpg']) assert.ok(DEMO_MEDIA_NAME.test(good), good);
    for (const bad of ['../logo.webp', 'a/b.png', 'logo.svg', '.hidden.png', 'Logo.webp', 'logo.webp.html']) {
      assert.equal(DEMO_MEDIA_NAME.test(bad), false, bad);
    }
  });
});
