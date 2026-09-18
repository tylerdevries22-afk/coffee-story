import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkPackOriginality, originalityDenylistFromEnv, originalityGateReady, parseOriginalityDenylist,
} from './originality';
import type { OriginalityPack } from './originality-scan';

// Invented placeholder names only -- never a real brand. This file must
// never spell one out, exactly like the module it tests.
const NAME = 'Rivalbrew';

const EMPTY_PACK: OriginalityPack = {
  brand: {},
  menu: { categories: [], items: [] },
  listing: { weekdayDescriptions: [] },
};

function packWith(overrides: Partial<OriginalityPack>): OriginalityPack {
  return { ...EMPTY_PACK, ...overrides };
}

describe('parseOriginalityDenylist', () => {
  it('splits on newlines and commas, trims each name, and drops blanks', () => {
    assert.deepEqual(parseOriginalityDenylist('Rivalbrew\nExamplecorp, Umbrella Roasters\n\n , '),
      ['Rivalbrew', 'Examplecorp', 'Umbrella Roasters']);
  });

  it('reads an unset or blank value as no names at all', () => {
    assert.deepEqual(parseOriginalityDenylist(undefined), []);
    assert.deepEqual(parseOriginalityDenylist(''), []);
    assert.deepEqual(parseOriginalityDenylist('   \n  ,  '), []);
  });
});

describe('originalityDenylistFromEnv and originalityGateReady', () => {
  it('reads DEMO_ORIGINALITY_DENYLIST only', () => {
    assert.deepEqual(originalityDenylistFromEnv({ DEMO_ORIGINALITY_DENYLIST: 'Rivalbrew,Examplecorp' }),
      ['Rivalbrew', 'Examplecorp']);
  });

  it('is unready when the list is unset or empty, same as a missing Places key', () => {
    assert.equal(originalityGateReady({}), false);
    assert.equal(originalityGateReady({ DEMO_ORIGINALITY_DENYLIST: '' }), false);
    assert.equal(originalityGateReady({ DEMO_ORIGINALITY_DENYLIST: '   ' }), false);
  });

  it('is ready as soon as one name survives parsing', () => {
    assert.equal(originalityGateReady({ DEMO_ORIGINALITY_DENYLIST: NAME }), true);
  });
});

describe('checkPackOriginality', () => {
  it('never hits with an empty denylist, however the pack reads -- the kill switch is what fails closed', () => {
    const pack = packWith({ brand: { business: { tagline: `Formerly ${NAME}` } } });
    assert.deepEqual(checkPackOriginality(NAME, pack, []), { hit: false, fields: [] });
  });

  it('hits on the business name and refuses', () => {
    const result = checkPackOriginality(`${NAME} Coffee House`, EMPTY_PACK, [NAME]);
    assert.deepEqual(result, { hit: true, fields: [{ field: 'businessName', count: 1 }] });
  });

  it('hits inside brand copy however deep it is nested, and leaves an innocent field alone', () => {
    const pack = packWith({ brand: { business: { tagline: `Formerly known as ${NAME}.` }, copy: { rewardMark: 'star' } } });
    const result = checkPackOriginality('Harbor Roast', pack, [NAME]);
    assert.deepEqual(result, { hit: true, fields: [{ field: 'brand.business.tagline', count: 1 }] });
  });

  it('hits in menu categories and items, by name and description, counting every occurrence', () => {
    const pack = packWith({
      menu: {
        categories: [{ id: 'drinks', title: `${NAME} favorites`, tagline: '' }],
        items: [
          { id: 'latte', name: `The ${NAME} Latte`, description: `Just like ${NAME} makes it.` },
          { id: 'scone', name: 'Scone', description: 'Plain and simple.' },
        ],
      },
    });
    const result = checkPackOriginality('Harbor Roast', pack, [NAME]);
    assert.equal(result.hit, true);
    assert.deepEqual(result.fields, [
      { field: 'menu.category.drinks.title', count: 1 },
      { field: 'menu.item.latte.name', count: 1 },
      { field: 'menu.item.latte.description', count: 1 },
    ]);
  });

  it('hits in the hours text Google published', () => {
    const pack = packWith({ listing: { weekdayDescriptions: [`Monday: closed while we visit ${NAME}`] } });
    const result = checkPackOriginality('Harbor Roast', pack, [NAME]);
    assert.deepEqual(result.fields, [{ field: 'listing.weekdayDescriptions[0]', count: 1 }]);
  });

  it('never returns the matched text -- only the field and how many times, in the result and in JSON', () => {
    const result = checkPackOriginality(`${NAME} ${NAME}`, EMPTY_PACK, [NAME]);
    assert.deepEqual(result.fields, [{ field: 'businessName', count: 2 }]);
    assert.equal(JSON.stringify(result).includes(NAME), false);
  });

  it('holds the word boundary on both sides: never inside a longer word, always next to punctuation', () => {
    const cases: readonly [string, boolean][] = [
      [`${NAME}ery downtown`, false],
      [`The Non${NAME} Cafe`, false],
      [`Co${NAME} Holdings`, false],
      [`(${NAME})`, true],
      [`${NAME}, Inc.`, true],
      [`"${NAME}"`, true],
      [`${NAME}.`, true],
      [NAME, true],
    ];
    for (const [text, expectHit] of cases) {
      assert.equal(checkPackOriginality(text, EMPTY_PACK, [NAME]).hit, expectHit, text);
    }
  });

  it('matches case-insensitively', () => {
    for (const text of [NAME.toUpperCase(), NAME.toLowerCase(), 'rIvAlBrEw']) {
      assert.equal(checkPackOriginality(text, EMPTY_PACK, [NAME]).hit, true, text);
    }
  });

  it('treats an accented Unicode letter as a word character on both sides of the boundary', () => {
    const accented = ['Rivalbrëw'];
    assert.equal(checkPackOriginality('RIVALBRËW', EMPTY_PACK, accented).hit, true, 'case-folds an accented letter');
    assert.equal(checkPackOriginality('rivalbrëwery', EMPTY_PACK, accented).hit, false, 'a letter glued on after is not a boundary');
    assert.equal(checkPackOriginality('coRivalbrëw', EMPTY_PACK, accented).hit, false, 'a letter glued on before is not a boundary');
    assert.equal(checkPackOriginality('pré-Rivalbrëw!', EMPTY_PACK, accented).hit, true, 'punctuation is a boundary');
  });

  it('checks every name on the list, independently', () => {
    const result = checkPackOriginality('Examplecorp and Umbrella Roasters, together', EMPTY_PACK,
      ['Examplecorp', 'Umbrella Roasters', NAME]);
    assert.deepEqual(result.fields, [{ field: 'businessName', count: 2 }]);
  });
});
