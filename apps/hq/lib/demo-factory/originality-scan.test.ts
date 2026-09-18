import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { packTextFields, type OriginalityPack } from './originality-scan';

const BASE: OriginalityPack = {
  brand: {},
  menu: { categories: [], items: [] },
  listing: { weekdayDescriptions: [] },
};

function fieldMap(pack: OriginalityPack, businessName = 'Harbor Roast'): Record<string, string> {
  return Object.fromEntries(packTextFields(businessName, pack).map((entry) => [entry.field, entry.text]));
}

describe('packTextFields', () => {
  it('reads the business name passed in, not something read off the pack', () => {
    assert.equal(fieldMap(BASE, 'Harbor Roast').businessName, 'Harbor Roast');
  });

  it('walks brand copy however deep it is nested, object or array', () => {
    const pack: OriginalityPack = {
      ...BASE,
      brand: {
        business: { tagline: 'Small batch, every day' },
        tokens: { primary: '#1a2b3c' },
        copy: { nested: { deeper: 'still found' } },
        information: { faq: [{ title: 'Do you deliver?' }] },
      },
    };
    const byField = fieldMap(pack);
    assert.equal(byField['brand.business.tagline'], 'Small batch, every day');
    assert.equal(byField['brand.tokens.primary'], '#1a2b3c');
    assert.equal(byField['brand.copy.nested.deeper'], 'still found');
    assert.equal(byField['brand.information.faq[0].title'], 'Do you deliver?');
  });

  it('leaves out a link target -- a guest never reads a URL as copy', () => {
    const pack: OriginalityPack = { ...BASE, brand: { business: { website: 'https://harborroast.example/about' } } };
    assert.equal('brand.business.website' in fieldMap(pack), false);
  });

  it('drops a blank string rather than flagging empty copy', () => {
    const pack: OriginalityPack = { ...BASE, brand: { business: { tagline: '   ' } } };
    assert.equal('brand.business.tagline' in fieldMap(pack), false);
  });

  it('reads every menu category and item by its position, never by an id', () => {
    const pack: OriginalityPack = {
      ...BASE,
      menu: {
        categories: [{ title: 'Coffee', tagline: 'Hot and cold' }],
        items: [{ name: 'Latte', description: 'Espresso and steamed milk' }],
      },
    };
    const byField = fieldMap(pack);
    assert.equal(byField['menu.categories[0].title'], 'Coffee');
    assert.equal(byField['menu.categories[0].tagline'], 'Hot and cold');
    assert.equal(byField['menu.items[0].name'], 'Latte');
    assert.equal(byField['menu.items[0].description'], 'Espresso and steamed milk');
  });

  it('drops a category or item field left blank, same as anywhere else', () => {
    const pack: OriginalityPack = {
      ...BASE,
      menu: { categories: [{ title: 'Coffee', tagline: '' }], items: [] },
    };
    assert.equal('menu.categories[0].tagline' in fieldMap(pack), false);
  });

  it('reads every weekday line Google published, by index', () => {
    const pack: OriginalityPack = {
      ...BASE,
      listing: { weekdayDescriptions: ['Monday: 7:00 AM – 3:00 PM', 'Tuesday: 7:00 AM – 3:00 PM'] },
    };
    const byField = fieldMap(pack);
    assert.equal(byField['listing.weekdayDescriptions[0]'], 'Monday: 7:00 AM – 3:00 PM');
    assert.equal(byField['listing.weekdayDescriptions[1]'], 'Tuesday: 7:00 AM – 3:00 PM');
  });

  it('reads a pack with nothing to say as an empty field list beyond the business name', () => {
    assert.deepEqual(packTextFields('Harbor Roast', BASE), [{ field: 'businessName', text: 'Harbor Roast' }]);
  });
});
