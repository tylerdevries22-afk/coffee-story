import type { PropsWithChildren } from 'react';

/**
 * Web stand-in for `@stripe/stripe-react-native`.
 *
 * The native SDK cannot be bundled for web at all — it imports React Native
 * internals — and the web build only ever runs the demo, where payments are
 * simulated and these functions are never reached.
 *
 * They still return Stripe's own `{ error }` shape rather than throwing, so if
 * a live path is ever taken here it surfaces as the same handled error every
 * caller already checks for, not an unhandled rejection.
 */
const UNAVAILABLE = {
  error: {
    code: 'PaymentSheetUnavailable',
    message: 'Card payments are not available in the browser demo.',
  },
} as const;

type StripeResult = typeof UNAVAILABLE;

/** Renders children unchanged; there is no native Stripe context on web. */
export function StripeProvider({ children }: PropsWithChildren<Record<string, unknown>>) {
  return children;
}

export function useStripe() {
  return {
    initPaymentSheet: async (): Promise<StripeResult> => UNAVAILABLE,
    presentPaymentSheet: async (): Promise<StripeResult> => UNAVAILABLE,
    confirmPayment: async (): Promise<StripeResult> => UNAVAILABLE,
  };
}
