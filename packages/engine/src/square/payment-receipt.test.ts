import assert from 'node:assert/strict';
import test from 'node:test';

import { settledPaymentFee, squareAppFeeCents } from './payment-receipt';

const receipt = { id: 'pay-a', status: 'COMPLETED', total_money: { amount: 10_000, currency: 'USD' },
  app_fee_money: { amount: 300, currency: 'USD' } };

test('settlement receipt validates identity, completion, currency, gross and fee', () => {
  assert.deepEqual(settledPaymentFee(receipt, 'pay-a', 10_000), { feeCents: 300, feeBpsApplied: 300 });
  for (const invalid of [undefined, {}, { ...receipt, id: 'other' }, { ...receipt, status: 'APPROVED' },
    { ...receipt, total_money: { amount: 10_001, currency: 'USD' } },
    { ...receipt, total_money: { amount: 10_000, currency: 'CAD' } },
    { ...receipt, app_fee_money: { amount: 10_001, currency: 'USD' } },
    { ...receipt, app_fee_money: { amount: -1, currency: 'USD' } }]) {
    assert.throws(() => settledPaymentFee(invalid, 'pay-a', 10_000), /invalid settlement receipt/);
  }
  for (const gross of [0, -1, 0.5, NaN, Infinity]) {
    assert.throws(() => settledPaymentFee(receipt, 'pay-a', gross), /invalid settlement receipt/);
  }
});

test('missing application fees are zero while malformed fees remain invalid', () => {
  assert.equal(squareAppFeeCents(undefined), 0);
  assert.equal(squareAppFeeCents({ amount: 0, currency: 'USD' }), 0);
  assert.deepEqual(settledPaymentFee({ ...receipt, app_fee_money: undefined }, 'pay-a', 10_000),
    { feeCents: 0, feeBpsApplied: 0 });
  for (const money of [null, {}, 300, { amount: '300', currency: 'USD' },
    { amount: 0.5, currency: 'USD' }, { amount: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' }]) {
    assert.equal(squareAppFeeCents(money), null);
  }
});
