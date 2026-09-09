import type { PaymentMethod } from '@platform/domain';

export type CheckoutPaymentMethod =
  | { kind: 'apple-pay' }
  | { kind: 'card'; method: PaymentMethod }
  /** Live tender until the brand connects card payments: settle at the counter. */
  | { kind: 'pay-at-pickup' };

export type RedeemControl = {
  availableCents: number;
  appliedCents: number;
  pointsCharged: number;
  pointsName: string;
  onToggle: () => void;
};

export type StoredValueControl = {
  balanceCents: number;
  appliedCents: number;
  enabled: boolean;
  onToggle: () => void;
};
