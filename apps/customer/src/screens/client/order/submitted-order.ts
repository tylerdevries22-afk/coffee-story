import type { OrderState } from './use-order-state';

export type SubmittedOrder = {
  submittedFulfillment: NonNullable<OrderState['order']['fulfillment']>;
  submittedWindowValue: string;
  submittedCart: OrderState['order']['cart'];
  submittedTipCents: number;
  submittedTotals: OrderState['totals'];
  submittedSignature: string;
  submittedGuestLabel: string | undefined;
  summary: string;
};
