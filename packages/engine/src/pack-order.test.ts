import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PackOrderError,
  validatePackSelection,
  type PackChoiceAvailability,
  type PackDefinition,
} from './pack-order';

const PACK: PackDefinition = {
  packSize: 4,
  choiceSource: 'lineup',
  eligibleItemSlugs: ['ethiopia', 'kenya'],
};

const CHOICES: PackChoiceAvailability[] = [
  {
    itemSlug: 'ethiopia', name: 'Ethiopia', isListed: true, is86d: false,
    packSize: null, rotation: 'permanent', dropOrderable: false,
  },
  {
    itemSlug: 'kenya', name: 'Kenya', isListed: true, is86d: false,
    packSize: null, rotation: 'rotating', dropOrderable: true,
  },
];

function rejects(code: PackOrderError['code'], run: () => unknown): void {
  assert.throws(run, (error) => error instanceof PackOrderError && error.code === code);
}

describe('validatePackSelection', () => {
  it('returns a canonical recipe with server-authored names', () => {
    assert.deepEqual(validatePackSelection(PACK, [
      { itemSlug: 'kenya', quantity: 1 },
      { itemSlug: 'ethiopia', quantity: 3 },
    ], CHOICES), [
      { item_slug: 'ethiopia', name: 'Ethiopia', quantity: 3 },
      { item_slug: 'kenya', name: 'Kenya', quantity: 1 },
    ]);
  });

  it('requires an exact count and unique positive entries', () => {
    rejects('invalid_request', () => validatePackSelection(PACK, [{ itemSlug: 'ethiopia', quantity: 3 }], CHOICES));
    rejects('invalid_request', () => validatePackSelection(PACK, [
      { itemSlug: 'ethiopia', quantity: 2 }, { itemSlug: 'ethiopia', quantity: 2 },
    ], CHOICES));
    rejects('invalid_request', () => validatePackSelection(PACK, [{ itemSlug: 'ethiopia', quantity: 0 }], CHOICES));
  });

  it('rejects unlisted, 86d, nested, expired, and unauthored choices', () => {
    for (const patch of [
      { isListed: false },
      { is86d: true },
      { packSize: 2 },
      { rotation: 'rotating' as const, dropOrderable: false },
    ]) {
      const unavailable = CHOICES.map((choice) => choice.itemSlug === 'ethiopia' ? { ...choice, ...patch } : choice);
      rejects('item_unavailable', () => validatePackSelection(PACK, [{ itemSlug: 'ethiopia', quantity: 4 }], unavailable));
    }
    rejects('invalid_request', () => validatePackSelection(PACK, [{ itemSlug: 'latte', quantity: 4 }], [
      ...CHOICES,
      { ...CHOICES[0]!, itemSlug: 'latte', name: 'Latte' },
    ]));
  });

  it('forbids packContents on ordinary items', () => {
    assert.deepEqual(validatePackSelection(
      { packSize: null, choiceSource: null, eligibleItemSlugs: [] }, undefined, [],
    ), []);
    rejects('invalid_request', () => validatePackSelection(
      { packSize: null, choiceSource: null, eligibleItemSlugs: [] }, [], [],
    ));
  });

  it('fails closed on invalid pack metadata', () => {
    rejects('catalog_invalid', () => validatePackSelection({ ...PACK, eligibleItemSlugs: [] }, [
      { itemSlug: 'ethiopia', quantity: 4 },
    ], CHOICES));
  });
});
