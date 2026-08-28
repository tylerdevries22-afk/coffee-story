import { computeAppFeeCents } from '@platform/engine';

export const PROPOSAL_BILLING_VERSION = '2026-08-26' as const;

export type SetupChoice = 'pay_in_full' | 'finance';
export type LocationKind = 'initial' | 'additional';

export interface ProposalTerms {
  readonly version: typeof PROPOSAL_BILLING_VERSION;
  readonly trialDays: 30;
  readonly setupCents: number;
  readonly setupInstallmentCents: number;
  readonly setupInstallments: number;
  readonly platformMonthlyCents: number;
  readonly feeBps: 200;
  readonly feeBpsTier2: 150;
  readonly tierThresholdCents: 2_500_000;
}

export interface GuaranteeEvaluation {
  readonly qualifies: boolean;
  readonly appRevenueShare: number;
  readonly cancelledSetupInstallments: number;
  readonly accountCreditCents: number;
}

export function proposalTermsFor(
  locationKind: LocationKind,
  setupChoice: SetupChoice,
): ProposalTerms {
  if (locationKind === 'additional') {
    return Object.freeze({ version: PROPOSAL_BILLING_VERSION, trialDays: 30, setupCents: 250_000, setupInstallmentCents: 250_000, setupInstallments: 1, platformMonthlyCents: 29_900, feeBps: 200, feeBpsTier2: 150, tierThresholdCents: 2_500_000 });
  }
  const finance = setupChoice === 'finance';
  return Object.freeze({ version: PROPOSAL_BILLING_VERSION, trialDays: 30, setupCents: finance ? 720_000 : 550_000, setupInstallmentCents: finance ? 60_000 : 550_000, setupInstallments: finance ? 12 : 1, platformMonthlyCents: 24_900, feeBps: 200, feeBpsTier2: 150, tierThresholdCents: 2_500_000 });
}

export function proposalCommissionCents(
  terms: ProposalTerms,
  monthGrossBeforeCents: number,
  appOrderGrossCents: number,
): number {
  return computeAppFeeCents(terms, monthGrossBeforeCents, appOrderGrossCents).feeCents;
}

export function evaluateDay90Guarantee(input: {
  readonly appGrossCents: number;
  readonly squareGrossCents: number;
  readonly setupPaidCents: number;
  readonly setupInstallmentsPaid: number;
  readonly setupInstallments: number;
}): GuaranteeEvaluation {
  const appGross = Math.max(0, Math.trunc(input.appGrossCents));
  const squareGross = Math.max(0, Math.trunc(input.squareGrossCents));
  const share = squareGross === 0 ? 0 : appGross / squareGross;
  const qualifies = share < 0.1;
  return Object.freeze({
    qualifies,
    appRevenueShare: share,
    cancelledSetupInstallments: qualifies ? Math.max(0, input.setupInstallments - input.setupInstallmentsPaid) : 0,
    accountCreditCents: qualifies ? Math.max(0, Math.trunc(input.setupPaidCents)) : 0,
  });
}
