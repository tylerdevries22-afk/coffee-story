import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { suggestIndustry } from './place-industry';

function place(primaryType: string | null, ...types: string[]) {
  return { primaryType, types: primaryType === null ? types : [primaryType, ...types] };
}

describe('the industry a Google listing suggests', () => {
  it('is confident when the primary type is what an industry is for', () => {
    const cases: readonly [string, string][] = [
      ['coffee_shop', 'coffee-shop'], ['cafe', 'coffee-shop'], ['tea_house', 'coffee-shop'],
      ['hotel', 'hospitality'], ['motel', 'hospitality'], ['bed_and_breakfast', 'hospitality'],
      ['general_contractor', 'construction'], ['plumber', 'construction'], ['roofing_contractor', 'construction'],
    ];
    for (const [primary, key] of cases) {
      const suggestion = suggestIndustry(place(primary, 'point_of_interest', 'establishment'));
      assert.equal(suggestion.key, key, primary);
      assert.equal(suggestion.confidence, 'high', primary);
      assert.match(suggestion.reason, new RegExp(`“${primary.replaceAll('_', ' ')}”`));
    }
  });

  it('recognises a trade Google has not named yet by its suffix', () => {
    assert.deepEqual(suggestIndustry(place('hvac_contractor')), {
      key: 'construction', confidence: 'high', reason: 'Google lists it as “hvac contractor”.',
    });
  });

  it('is less sure of a neighbour than of the thing itself', () => {
    const bakery = suggestIndustry(place('bakery', 'food', 'store'));
    assert.equal(bakery.key, 'coffee-shop');
    assert.equal(bakery.confidence, 'medium');
    assert.equal(suggestIndustry(place('wedding_venue')).key, 'hospitality');
    assert.equal(suggestIndustry(place('wedding_venue')).confidence, 'medium');
    assert.equal(suggestIndustry(place('locksmith')).key, 'construction');
  });

  it('takes a secondary type at medium, and a secondary neighbour at low', () => {
    assert.deepEqual(suggestIndustry(place('store', 'cafe', 'food')), {
      key: 'coffee-shop', confidence: 'medium', reason: 'Google also lists it as “cafe”.',
    });
    assert.deepEqual(suggestIndustry(place('store', 'bakery')), {
      key: 'coffee-shop', confidence: 'low', reason: 'Google also lists it as “bakery”.',
    });
  });

  it('keeps the stronger claim when a listing fits two industries', () => {
    // A hotel with a café in it is still a hotel.
    assert.equal(suggestIndustry(place('hotel', 'cafe')).key, 'hospitality');
    assert.equal(suggestIndustry(place('cafe', 'lodging')).key, 'coffee-shop');
  });

  it('sends food service to the café blueprint at low confidence', () => {
    for (const primary of ['pizza_restaurant', 'restaurant', 'wine_bar', 'diner']) {
      const suggestion = suggestIndustry(place(primary, 'food'));
      assert.equal(suggestion.key, 'coffee-shop', primary);
      assert.equal(suggestion.confidence, 'low', primary);
      assert.match(suggestion.reason, /nearest one with ordering/);
    }
  });

  it('falls back to general, at low confidence, with the reason why', () => {
    assert.deepEqual(suggestIndustry(place('hair_salon', 'beauty_salon')), {
      key: 'general', confidence: 'low',
      reason: 'Google lists it as “hair salon”, which matches no specific industry.',
    });
    assert.deepEqual(suggestIndustry(place(null)), {
      key: 'general', confidence: 'low', reason: 'Google gives no category for it.',
    });
  });

  it('reads the secondary types when Google names no primary type', () => {
    assert.deepEqual(suggestIndustry(place(null, 'lodging', 'establishment')), {
      key: 'hospitality', confidence: 'medium', reason: 'Google also lists it as “lodging”.',
    });
  });
});
