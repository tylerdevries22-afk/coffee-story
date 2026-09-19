import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { kitMenu } from './kit';
import { demoKitFrom, kitColors, kitLogoUrl, kitTagline } from './site-kit-map';
import { crawlOf, extractionOf } from './site-kit.test-support';

describe('demoKitFrom', () => {
  it('builds the kit from the crawl and the model: palette, tagline, address, logo and a priced menu', () => {
    const kit = demoKitFrom(crawlOf(), extractionOf(), 'logo.webp');
    assert.deepEqual(kit.colors, ['#0b2545', '#e4572e']);
    assert.equal(kit.tagline, 'Waterfront coffee, roasted in Boulder.');
    assert.equal(kit.email, 'hello@harborroast.example', 'the address the business ranks first');
    assert.equal(kit.logo, 'logo.webp');
    assert.deepEqual(kit.menu.map((item) => [item.name, item.priceCents, item.image]),
      [['Latte', 525, null], ['Mocha', 575, null], ['Scone', 350, null]]);
    assert.ok(kitMenu(kit), 'enough priced items for the menu to stand');
  });

  it('still gives a demo its colors, address and logo when no model read the site', () => {
    const kit = demoKitFrom(crawlOf(), null, 'logo.webp');
    assert.deepEqual(kit.colors, ['#0b2545', '#1b998b'], 'the site’s own colors, neutrals left out');
    assert.equal(kit.email, 'hello@harborroast.example');
    assert.deepEqual(kit.menu, []);
    assert.equal(kitMenu(kit), null, 'so the demo shows the labelled sample');
  });

  it('has no address to offer when the site publishes none', () => {
    assert.equal(demoKitFrom(crawlOf({ contactEmails: [] }), null, null).email, null);
  });
});

describe('kitColors', () => {
  it('keeps only real, distinct colors, at most four', () => {
    assert.deepEqual(kitColors(crawlOf(), { colors: ['#AABBCC', '#aabbcc', 'red', '#12345', '#010101', '#020202', '#030303', '#040404'] }),
      ['#aabbcc', '#010101', '#020202', '#030303']);
    assert.deepEqual(kitColors(crawlOf({ colors: [] }), { colors: [] }), []);
  });
});

describe('kitTagline', () => {
  it('prefers the business’s own words, then the first sentence of the summary', () => {
    assert.equal(kitTagline('  Waterfront   coffee. ', 'Ignored.'), 'Waterfront coffee.');
    assert.equal(kitTagline(null, 'Harbor Roast roasts in Boulder. It opens at seven.'), 'Harbor Roast roasts in Boulder.');
    assert.equal(kitTagline('x'.repeat(200), 'Short and true.'), 'Short and true.');
    assert.equal(kitTagline(null, 'y'.repeat(200)), null, 'nothing short enough to be a tagline');
    assert.equal(kitTagline(null, null), null);
  });
});

describe('kitLogoUrl', () => {
  it('takes the model’s pick among the candidates, else the crawl’s best', () => {
    assert.equal(kitLogoUrl(crawlOf(), extractionOf({ logoUrl: 'https://www.harborroast.example/mark.png' })),
      'https://www.harborroast.example/mark.png');
    assert.equal(kitLogoUrl(crawlOf(), null), 'https://www.harborroast.example/logo.png');
    assert.equal(kitLogoUrl(crawlOf({ logos: [] }), extractionOf({ logoUrl: null })), null);
  });
});
