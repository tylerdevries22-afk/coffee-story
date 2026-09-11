import Constants from 'expo-constants';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { MenuItem } from '@/data/catalog';
import { summarizeGiftCardOwnership } from '@/features/gifts/ownership';
import {
  checkoutAttemptSignature
} from '@/features/order/demo-checkout';
import {
  maxRedeemableCents,
  splitPayment
} from '@/features/order/payment-split';
import { usesSimulatedNativeFlows } from '@/lib/native-adapters';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { useOrder } from '@/state/order-context';
import { TENANT_REWARD_TIERS, TENANT_TAX_JURISDICTIONS, tenantFeature } from '@/tenant';
import type { FulfillmentMode } from '@platform/domain';
import {
  orderTotals, pointsForOrder,
  tierForAnnualPoints
} from '@platform/domain';
import type { OrderStatus } from '@platform/schema';

import { type CheckoutPaymentMethod } from './checkout-step';

import type { Overlay, SetupStep } from './order-flow';
export function useOrderState() {
  const { isDemo, portal } = useAuth();
  const demo = useDemo();
  const order = useOrder();
  const { selectedServiceId, setBarCovered, setClientTab, openMore } = useAppState();

  const [mode, setMode] = useState<FulfillmentMode | null>(null);
  const [step, setStep] = useState<SetupStep>('hub');
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
  const [paying, setPaying] = useState(false);
  // `paying` is set and cleared inside one synchronous handler, so React
  // batches it and the button never actually renders disabled. The checkout
  // page also stays mounted and touchable through its 220ms exit, so a second
  // tap would run `demo.book` again -- against a bag the first tap emptied.
  const placing = useRef(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [redeemCents, setRedeemCents] = useState(0);
  const [useGiftBalance, setUseGiftBalance] = useState(false);
  // Snapshotted at the moment the order is placed. Reading `totals` here
  // instead would show the confirmation screen the totals of the bag that
  // `clearBag()` has just emptied -- "Paid $0", earning 0 Beans.
  // orderId is present for live orders only; it drives realtime tracking.
  const [placed, setPlaced] = useState<{
    summary: string;
    totalCents: number;
    points: number;
    status: OrderStatus;
    orderId?: string;
    demoSynced?: boolean;
    demoSyncSessionId?: string;
  } | null>(null);
  // One key per checkout ATTEMPT: held across retries of the same order so
  // the server returns the already-created order instead of ringing twice;
  // released only once placement succeeds.
  const checkoutKey = useRef<string | null>(null);

  const simulated = usesSimulatedNativeFlows(isDemo, Constants.appOwnership ?? null);
  const guestName = order.guestName;

  const totals = useMemo(() => orderTotals({
    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    discountCents: redeemCents,
    tipCents: order.tipCents,
    jurisdictions: TENANT_TAX_JURISDICTIONS,
  }), [order.deliveryFeeCents, order.subtotalCents, order.tipCents, redeemCents]);

  const annualPoints = portal.rewardAccount.annualPoints;
  const redeemableCents = maxRedeemableCents(portal.rewardAccount.availablePoints, order.subtotalCents);
  const giftBalanceCents = tenantFeature('stored_value')
    ? summarizeGiftCardOwnership(portal.giftCards).spendableBalanceCents
    : 0;
  const split = splitPayment(totals.totalCents, giftBalanceCents, useGiftBalance);

  // The bag can shrink under an applied redemption (a line removed from the
  // bag while checkout is open); a stale discount would survive into the pay
  // button, so it resets rather than clamps -- the guest re-applies knowingly.
  useEffect(() => {
    if (redeemCents > 0 && redeemCents > redeemableCents) setRedeemCents(0);
  }, [redeemCents, redeemableCents]);

  // The idempotency key identifies one CART, not one order to this screen.
  // It used to be released only on success, so after a request that timed
  // out server-side -- the order written, the response lost -- a guest who
  // added a croissant and pressed Place Order again sent the same key. The
  // server replayed the original order, the app cleared the bag and said
  // "Order placed", and the croissant was never ordered. Anything that
  // changes what is being bought retires the key.
  const cartSignature = checkoutAttemptSignature({
    cart: order.cart,
    deliveryFeeCents: order.deliveryFeeCents,
    fulfillmentMode: order.fulfillment?.mode ?? null,
    guestName,
    redeemCents,
    tipCents: order.tipCents,
    windowValue: order.windowValue,
  });
  const cartSignatureRef = useRef(cartSignature);
  cartSignatureRef.current = cartSignature;
  useEffect(() => {
    checkoutKey.current = null;
  }, [cartSignature]);
  const pointsPerDollar = tierForAnnualPoints(annualPoints, TENANT_REWARD_TIERS).pointsPerDollar;
  const pointsEarned = pointsForOrder(totals, annualPoints, TENANT_REWARD_TIERS);

  // Live orders settle at the counter until the brand connects card
  // payments; the demo keeps its saved-card flow.
  const savedCard = (portal.paymentMethods ?? []).find((method) => method.isDefault)
    ?? (portal.paymentMethods ?? [])[0];
  const payment: CheckoutPaymentMethod | null = !isDemo
    ? { kind: 'pay-at-pickup' }
    : savedCard
      ? { kind: 'card', method: savedCard }
      : null;
  return {
    isDemo, portal, demo, order, selectedServiceId, setBarCovered, setClientTab, openMore, mode, setMode, step, setStep, overlay, setOverlay, detailItem, setDetailItem, paying, setPaying, placing, payError, setPayError, redeemCents, setRedeemCents, useGiftBalance, setUseGiftBalance, placed, setPlaced, checkoutKey, simulated, guestName, totals, annualPoints, redeemableCents, giftBalanceCents, split, cartSignature, cartSignatureRef, pointsPerDollar, pointsEarned, payment
  };
}
export type OrderState = ReturnType<typeof useOrderState>;
