import assert from 'node:assert/strict';
import test from 'node:test';

import {
  settledPaymentFee, squareAppFeeCents, squareApplicationFeeCapCents,
} from './payment-receipt';

const receipt = { id: 'pay-a', location_id: 'location-a', status: 'COMPLETED',
  total_money: { amount: 10_000, currency: 'USD' },
  app_fee_money: { amount: 300, currency: 'USD' } };

test('settlement receipt validates identity, completion, currency, gross and fee', () => {
  assert.deepEqual(settledPaymentFee(receipt, 'pay-a', 10_000, 300, 'location-a'),
    { feeCents: 300, feeBpsApplied: 300 });
  for (const invalid of [undefined, {}, { ...receipt, id: 'other' }, { ...receipt, status: 'APPROVED' },
    { ...receipt, total_money: { amount: 10_001, currency: 'USD' } },
    { ...receipt, total_money: { amount: 10_000, currency: 'CAD' } },
    { ...receipt, app_fee_money: { amount: 10_001, currency: 'USD' } },
    { ...receipt, app_fee_money: { amount: -1, currency: 'USD' } }]) {
    assert.throws(() => settledPaymentFee(
      invalid, 'pay-a', 10_000, 300, 'location-a',
    ), /invalid settlement receipt/);
  }
  for (const gross of [0, -1, 0.5, NaN, Infinity]) {
    assert.throws(() => settledPaymentFee(
      receipt, 'pay-a', gross, 300, 'location-a',
    ), /invalid settlement receipt/);
  }
});

test('settlement requires the exact quoted application fee', () => {
  assert.equal(squareAppFeeCents(undefined), 0);
  assert.equal(squareAppFeeCents({ amount: 0, currency: 'USD' }), 0);
  for (const app_fee_money of [undefined, { amount: 0, currency: 'USD' },
    { amount: 299, currency: 'USD' }]) {
    assert.throws(() => settledPaymentFee(
      { ...receipt, app_fee_money }, 'pay-a', 10_000, 300, 'location-a',
    ), /invalid settlement receipt/);
  }
  for (const money of [null, {}, 300, { amount: '300', currency: 'USD' },
    { amount: 0.5, currency: 'USD' }, { amount: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' }]) {
    assert.equal(squareAppFeeCents(money), null);
  }
});

test('USD application-fee caps round down at the five-dollar boundary', () => {
  assert.equal(squareApplicationFeeCapCents(1), 0);
  assert.equal(squareApplicationFeeCapCents(499), 299);
  assert.equal(squareApplicationFeeCapCents(500), 450);
  const small = { ...receipt, total_money: { amount: 499, currency: 'USD' },
    app_fee_money: { amount: 299, currency: 'USD' } };
  assert.equal(settledPaymentFee(small, 'pay-a', 499, 299, 'location-a').feeCents, 299);
  assert.throws(() => settledPaymentFee(
    { ...small, app_fee_money: { amount: 300, currency: 'USD' } },
    'pay-a', 499, 300, 'location-a',
  ), /invalid settlement receipt/);
});
