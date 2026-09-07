import * as Haptics from 'expo-haptics';
import { useCallback, useEffect } from 'react';

import type { FulfillmentMode, OrderFulfillment } from '@platform/domain';


import { overlayAtLeast, setupAtLeast, type Overlay, type SetupStep } from './order-flow';
import { useOrderState } from './use-order-state';
import { usePlaceOrder } from './use-place-order';

export function useOrderController() {
  const state = useOrderState();
  const { portal, order, setBarCovered, setMode, step, setStep, overlay, setOverlay, placing, setRedeemCents, setUseGiftBalance, setPlaced } = state;
  const startWith = useCallback((next: FulfillmentMode) => {
    setMode(next);
    setStep('place');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, [setMode, setStep]);

  // Seeded once, rather than falling back to the profile name at render time.
  // With a fallback, clearing the field wrote '' to the context and the render
  // immediately put the profile name back -- the clear button did nothing.
  useEffect(() => {
    if (step === 'place' && !order.guestName && portal.profile.fullName) {
      order.setGuestName(portal.profile.fullName);
    }
  }, [order, portal.profile.fullName, step]);

  const choosePlace = useCallback((fulfillment: OrderFulfillment) => {
    order.setFulfillment(fulfillment);
    setStep('details');
  }, [order, setStep]);

  const editOrder = useCallback(() => {
    order.setFulfillment(null);
    setOverlay('none');
    setMode(null);
    setStep('hub');
    setPlaced(null);
    setRedeemCents(0);
    setUseGiftBalance(false);
    placing.current = false;
  }, [order, placing, setMode, setOverlay, setPlaced, setRedeemCents, setStep, setUseGiftBalance]);


  // The web tab bar hides while a covering page is up (see app-context).
  // hub and menu keep the bar, exactly like native.
  useEffect(() => {
    setBarCovered(step === 'place' || step === 'details' || overlay !== 'none');
    return () => setBarCovered(false);
  }, [overlay, setBarCovered, step]);
  const placeOrder = usePlaceOrder(state);
  return {
    ...state, startWith, choosePlace, editOrder, placeOrder,
    overlayAtLeast: (level: Overlay) => overlayAtLeast(overlay, level),
    setupAtLeast: (level: SetupStep) => setupAtLeast(step, level),
  };
}
export type OrderController = ReturnType<typeof useOrderController>;
