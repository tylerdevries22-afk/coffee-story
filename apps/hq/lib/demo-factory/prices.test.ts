import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEMO_ESTIMATE_ASSUMPTIONS, estimateDemoMicrousd, formatMicrousd, lineCostMicrousd, openAiPrices,
} from './prices';

describe('lineCostMicrousd', () => {
  it('prices Google calls per call, and the IDs-only search at nothing', () => {
    assert.equal(lineCostMicrousd({ provider: 'google_places', sku: 'place_details_enterprise', quantity: 1 }), 20_000);
    assert.equal(lineCostMicrousd({ provider: 'google_places', sku: 'place_details_atmosphere', quantity: 2 }), 50_000);
    assert.equal(lineCostMicrousd({ provider: 'google_places', sku: 'place_photo', quantity: 3 }), 21_000);
    assert.equal(lineCostMicrousd({ provider: 'google_places', sku: 'text_search_ids', quantity: 40 }), 0);
  });

  it('prices tokens per million, rounding each line up so a sum never undercounts', () => {
    assert.equal(lineCostMicrousd({ provider: 'openai', sku: 'input_tokens', model: 'gpt-5-nano', quantity: 15_000 }), 750);
    assert.equal(lineCostMicrousd({ provider: 'openai', sku: 'output_tokens', model: 'gpt-5-nano', quantity: 3_000 }), 1_200);
    assert.equal(lineCostMicrousd({ provider: 'openai', sku: 'input_tokens', model: 'gpt-5-nano', quantity: 1 }), 1);
    assert.equal(lineCostMicrousd({ provider: 'openai', sku: 'cached_input_tokens', model: 'gpt-5-mini', quantity: 40_000 }), 1_000);
  });

  it('counts nothing for a quantity that is not a positive number', () => {
    for (const quantity of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(lineCostMicrousd({ provider: 'google_places', sku: 'place_photo', quantity }), 0, String(quantity));
    }
  });
});

describe('openAiPrices', () => {
  it('recognises a dated snapshot by its family, longest name first', () => {
    assert.equal(openAiPrices('gpt-5-mini-2025-08-07').output_tokens, 2_000_000);
    assert.equal(openAiPrices('gpt-5-nano').output_tokens, 400_000);
    assert.equal(openAiPrices('gpt-5-2025-08-07').output_tokens, 10_000_000);
  });

  it('prices a model it does not know as the dearest it does, so the brake errs early', () => {
    for (const model of ['gpt-5.1', 'some-future-model', '', 'gpt-5-minis']) {
      assert.equal(openAiPrices(model).output_tokens, 10_000_000, model);
    }
  });
});

describe('estimateDemoMicrousd', () => {
  it('is one Details call, 0.8 photos, a nano pass and a mini re-run for three in ten', () => {
    // 20,000 + 5,600 + (750 + 1,200) + ceil((3,750 + 6,000) * 0.3)
    assert.equal(estimateDemoMicrousd(), 30_475);
  });

  it('moves with its stated assumptions', () => {
    assert.equal(estimateDemoMicrousd({ ...DEMO_ESTIMATE_ASSUMPTIONS, escalationShare: 0 }), 27_550);
    assert.equal(estimateDemoMicrousd({ ...DEMO_ESTIMATE_ASSUMPTIONS, photosPerBusiness: 2 }), 38_875);
  });
});

describe('formatMicrousd', () => {
  it('shows four places below a dollar and cents from a dollar up', () => {
    assert.equal(formatMicrousd(30_475), '$0.0305');
    assert.equal(formatMicrousd(20_000), '$0.0200');
    assert.equal(formatMicrousd(0), '$0.0000');
    assert.equal(formatMicrousd(999_999), '$1');
    assert.equal(formatMicrousd(10_000_000), '$10');
    assert.equal(formatMicrousd(12_345_678), '$12.35');
  });

  it('never prints a negative or a NaN', () => {
    assert.equal(formatMicrousd(-5), '$0.0000');
    assert.equal(formatMicrousd(Number.NaN), '$0.0000');
  });
});
