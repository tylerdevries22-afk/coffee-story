import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MenuPricingError, priceLine, type MenuItemPricing } from './menu-pricing';

const LATTE: MenuItemPricing = {
  slug: 'latte',
  name: 'Latte',
  base_price_cents: 450,
  sizes: [
    { slug: '12', label: '12 oz', price_cents: 450 },
    { slug: '16', label: '16 oz', price_cents: 525 },
  ],
  modifiers: [
    {
      id: 'milk', name: 'Milk', select: 'single', required: false, maxChoices: 1,
      choices: [
        { id: 'milk-whole', name: 'Whole Milk', priceDeltaCents: 0 },
        { id: 'milk-oat', name: 'Oat Milk', priceDeltaCents: 75 },
      ],
    },
    {
      id: 'extras', name: 'Add-ins', select: 'multi', required: false, maxChoices: 2,
      choices: [
        { id: 'extra-shot', name: 'Extra Shot', priceDeltaCents: 100 },
        { id: 'extra-vanilla', name: 'Vanilla', priceDeltaCents: 75 },
        { id: 'extra-honey', name: 'Honey', priceDeltaCents: 50 },
      ],
    },
    {
      id: 'ice', name: 'Ice', select: 'single', required: true, maxChoices: 1,
      dependsOn: { groupId: 'serve', choiceIds: ['serve-iced'] },
      choices: [{ id: 'ice-regular', name: 'Regular Ice', priceDeltaCents: 0 }],
    },
    {
      id: 'serve', name: 'Serve', select: 'single', required: true, maxChoices: 1,
      choices: [
        { id: 'serve-hot', name: 'Hot', priceDeltaCents: 0 },
        { id: 'serve-iced', name: 'Iced', priceDeltaCents: 0 },
      ],
    },
  ],
};

const COOKIE: MenuItemPricing = {
  slug: 'cookie', name: 'Cookie', base_price_cents: 350, sizes: [], modifiers: [],
};

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof MenuPricingError) return error.code;
    throw error;
  }
  throw new Error('expected a MenuPricingError');
}

describe('priceLine', () => {
  it('prices size + positive deltas x quantity, names for the snapshot', () => {
    const priced = priceLine(LATTE, {
      sizeSlug: '16', quantity: 2, modifierSlugs: ['milk-oat', 'extra-shot', 'serve-hot'],
    });
    assert.equal(priced.unitPriceCents, 525 + 75 + 100);
    assert.equal(priced.lineTotalCents, 1400);
    assert.deepEqual(priced.optionNames, ['16 oz', 'Oat Milk', 'Extra Shot', 'Hot']);
  });

  it('uses base_price_cents when the item has no sizes', () => {
    const priced = priceLine(COOKIE, { quantity: 3 });
    assert.equal(priced.lineTotalCents, 1050);
  });

  it('rejects what the menu does not sell', () => {
    assert.equal(code(() => priceLine(LATTE, { quantity: 1, modifierSlugs: ['serve-hot'] })), 'size_required');
    assert.equal(code(() => priceLine(LATTE, { sizeSlug: '20', quantity: 1, modifierSlugs: ['serve-hot'] })), 'size_unknown');
    assert.equal(code(() => priceLine(COOKIE, { sizeSlug: '12', quantity: 1 })), 'size_unknown');
    assert.equal(code(() => priceLine(LATTE, { sizeSlug: '12', quantity: 1, modifierSlugs: ['serve-hot', 'extra-caramel'] })), 'modifier_unknown');
    assert.equal(code(() => priceLine(LATTE, { sizeSlug: '12', quantity: 0 })), 'quantity_invalid');
    assert.equal(code(() => priceLine(LATTE, { sizeSlug: '12', quantity: 1.5 })), 'quantity_invalid');
  });

  it('enforces the option-group rules server-side', () => {
    // Required group missing.
    assert.equal(code(() => priceLine(LATTE, { sizeSlug: '12', quantity: 1 })), 'modifier_invalid');
    // Over the multi cap.
    assert.equal(code(() => priceLine(LATTE, {
      sizeSlug: '12', quantity: 1,
      modifierSlugs: ['serve-hot', 'extra-shot', 'extra-vanilla', 'extra-honey'],
    })), 'modifier_invalid');
    // Two picks in a single group.
    assert.equal(code(() => priceLine(LATTE, {
      sizeSlug: '12', quantity: 1, modifierSlugs: ['serve-hot', 'milk-whole', 'milk-oat'],
    })), 'modifier_invalid');
    // A choice from a hidden dependent group.
    assert.equal(code(() => priceLine(LATTE, {
      sizeSlug: '12', quantity: 1, modifierSlugs: ['serve-hot', 'ice-regular'],
    })), 'modifier_invalid');
    // The dependent group becomes required once visible.
    assert.equal(code(() => priceLine(LATTE, {
      sizeSlug: '12', quantity: 1, modifierSlugs: ['serve-iced'],
    })), 'modifier_invalid');
    // And satisfied when chosen.
    const iced = priceLine(LATTE, { sizeSlug: '12', quantity: 1, modifierSlugs: ['serve-iced', 'ice-regular'] });
    assert.equal(iced.unitPriceCents, 450);
  });

  it('never lets a negative delta price an item down', () => {
    const rigged: MenuItemPricing = {
      ...COOKIE,
      modifiers: [{
        id: 'g', name: 'G', select: 'single', required: false, maxChoices: 1,
        choices: [{ id: 'down', name: 'Down', priceDeltaCents: -200 }],
      }],
    };
    const priced = priceLine(rigged, { quantity: 1, modifierSlugs: ['down'] });
    assert.equal(priced.unitPriceCents, 350);
  });

  it('rejects a malformed catalog row as a unit', () => {
    assert.equal(code(() => priceLine({ ...COOKIE, sizes: 'bad' }, { quantity: 1 })), 'catalog_invalid');
    assert.equal(code(() => priceLine({ ...COOKIE, modifiers: [{ id: 1 }] }, { quantity: 1 })), 'catalog_invalid');
    assert.equal(code(() => priceLine({ ...COOKIE, base_price_cents: -1 }, { quantity: 1 })), 'catalog_invalid');
    assert.equal(code(() => priceLine({
      ...COOKIE,
      modifiers: [
        { id: 'first', name: 'First', select: 'single', required: false, maxChoices: 1,
          choices: [{ id: 'same', name: 'One', priceDeltaCents: 0 }] },
        { id: 'second', name: 'Second', select: 'single', required: false, maxChoices: 1,
          choices: [{ id: 'same', name: 'Two', priceDeltaCents: 100 }] },
      ],
    }, { quantity: 1 })), 'catalog_invalid');
    assert.equal(code(() => priceLine({
      ...COOKIE,
      modifiers: [{
        id: 'child', name: 'Child', select: 'single', required: false, maxChoices: 1,
        dependsOn: { groupId: 'missing', choiceIds: ['nope'] },
        choices: [{ id: 'choice', name: 'Choice', priceDeltaCents: 0 }],
      }],
    }, { quantity: 1 })), 'catalog_invalid');
  });
});
