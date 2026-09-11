import assert from 'node:assert/strict';
import test from 'node:test';

import { squareCardFundingAmounts } from './square-card-funding';

test('Square card funding keeps an externally valid order total', () => {
  assert.deepEqual(squareCardFundingAmounts(10_000, 500), {
    providerOrderTotalCents: 9_500, providerTipCents: 500,
  });
  assert.deepEqual(squareCardFundingAmounts(250, 500), {
    providerOrderTotalCents: 250, providerTipCents: 0,
  });
  assert.throws(() => squareCardFundingAmounts(0, 0), RangeError);
  assert.throws(() => squareCardFundingAmounts(500, -1), RangeError);
});
