import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateDay90Guarantee,
  proposalCommissionCents,
  proposalTermsFor,
} from './billing';

describe('proposal billing terms', () => {
  it('keeps setup financing separate from platform support', () => {
    const terms = proposalTermsFor('initial', 'finance');
    assert.equal(terms.setupInstallmentCents, 60_000);
    assert.equal(terms.setupInstallments, 12);
    assert.equal(terms.platformMonthlyCents, 24_900);
  });

  it('prices each additional location independently', () => {
    const terms = proposalTermsFor('additional', 'pay_in_full');
    assert.equal(terms.setupCents, 250_000);
    assert.equal(terms.platformMonthlyCents, 29_900);
  });

  it('applies the lower rate only above the monthly threshold', () => {
    const terms = proposalTermsFor('initial', 'pay_in_full');
    assert.equal(proposalCommissionCents(terms, 2_490_000, 20_000), 350);
  });
});

describe('day-90 guarantee', () => {
  it('credits paid setup and cancels unpaid installments below ten percent', () => {
    const result = evaluateDay90Guarantee({ appGrossCents: 900_000, squareGrossCents: 10_000_000, setupPaidCents: 180_000, setupInstallmentsPaid: 3, setupInstallments: 12 });
    assert.equal(result.qualifies, true);
    assert.equal(result.accountCreditCents, 180_000);
    assert.equal(result.cancelledSetupInstallments, 9);
  });

  it('does not issue a credit at exactly ten percent', () => {
    const result = evaluateDay90Guarantee({ appGrossCents: 1_000_000, squareGrossCents: 10_000_000, setupPaidCents: 550_000, setupInstallmentsPaid: 1, setupInstallments: 1 });
    assert.equal(result.qualifies, false);
    assert.equal(result.accountCreditCents, 0);
  });
});
