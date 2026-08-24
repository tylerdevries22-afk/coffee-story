import { Slot, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { formatMoney, orderItemCount, orderSubtotalCents, orderTotals } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { KioskCartDrawer } from '@/components/cart-drawer';
import { KioskChrome } from '@/components/chrome/kiosk-chrome';
import { StepStage } from '@/components/chrome/step-stage';
import { KioskUtilityPanel } from '@/components/utility-panel';
import { resetExperience as runExperienceReset } from '@/features/experience-reset';
import { cartButtonLabel } from '@/features/cart-drawer';
import { routeMatchesStep } from '@/features/step-flow';
import { useBuilder } from '@/state/builder';
import { useFlow } from '@/state/flow';
import { useGuest } from '@/state/guest';
import { useKioskSession } from '@/state/session';
import { TENANT_TAX } from '@/tenant/tax';

const CART_STEPS = new Set(['entry', 'node', 'item', 'options', 'pack', 'fill', 'review', 'bag']);

/**
 * Everything inside the ordering flow shares one frame.
 *
 * The group `(flow)` does not appear in the URL, so `order/entry.tsx` is still
 * `/order/entry` -- the routes stay addressable, which is what lets
 * `scripts/capture-surfaces.mjs` screenshot each step by navigating to it.
 */
export default function FlowLayout() {
  const tokens = useTokens();
  const pathname = usePathname();
  const {
    flow, step, backTarget, goBack, goTo, startOver,
    activeUtility, openUtility, closeUtility, cartOpen, openCart,
  } = useFlow();
  const { cart, touch, reset, resetSeq, committed } = useKioskSession();
  const { clear: clearGuest } = useGuest();
  const builder = useBuilder();
  const routeReady = routeMatchesStep(pathname, step);
  const checkoutLocked = step === 'done' || (step === 'processing' && committed);
  const cartAvailable = CART_STEPS.has(step) && cart.lines.length > 0;
  const cartTotals = orderTotals({
    subtotalCents: orderSubtotalCents(cart),
    jurisdictions: TENANT_TAX,
  });
  const modalBackgroundProps = Platform.OS === 'web' && cartOpen ? { inert: true } : {};

  useEffect(() => {
    if (!routeReady) goTo(step);
  }, [goTo, routeReady, step]);

  function resetExperience() {
    runExperienceReset({
      resetSession: reset,
      clearGuest,
      resetBuilder: builder.reset,
      navigate: startOver,
    });
  }

  /**
   * An idle reset has to navigate as well as clear, or a guest whose session
   * timed out is left looking at a fill screen with an empty tray.
   *
   * It watches for a CHANGE, not for a non-zero value. Testing `resetSeq > 0`
   * made the kiosk impossible to enter: the attract screen calls `reset()`
   * before navigating, so the counter was already 1 by the time this layout
   * first mounted, the mount effect fired, and every tap bounced straight back
   * to attract. The seed is taken on mount for exactly that reason.
   */
  const seenReset = useRef(resetSeq);
  useEffect(() => {
    if (resetSeq === seenReset.current) return;
    seenReset.current = resetSeq;
    runExperienceReset({
      resetSession: reset,
      clearGuest,
      resetBuilder: builder.reset,
      navigate: startOver,
    }, true);
    // `startOver` is recreated whenever the flow's facts change; depending on it
    // would throw a guest out of the step they are standing in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSeq]);

  return (
    <View style={[styles.root, { backgroundColor: tokens.surface }]} onTouchStart={touch}>
      <View
        {...modalBackgroundProps}
        accessibilityElementsHidden={cartOpen}
        aria-hidden={cartOpen}
        importantForAccessibility={cartOpen ? 'no-hide-descendants' : 'auto'}
        style={styles.content}
      >
        <KioskChrome
          utilities={checkoutLocked ? [] : flow.utilities}
          canStartOver={!checkoutLocked}
          canGoBack={backTarget !== null}
          onBack={goBack}
          onStartOver={resetExperience}
          onUtility={openUtility}
          cart={cartAvailable ? {
            count: orderItemCount(cart),
            amount: formatMoney(cartTotals.totalCents),
            accessibilityLabel: cartButtonLabel(cart, cartTotals.totalCents),
          } : undefined}
          onCart={cartAvailable ? openCart : undefined}
        />
        <StepStage stepKey={step}>
          {/* Never mount a stale deep-linked page. Processing owns money-moving
              effects, so reconciling only after its first render is too late. */}
          {routeReady ? <Slot /> : null}
        </StepStage>
      </View>
      {activeUtility ? (
        <KioskUtilityPanel utility={activeUtility} onClose={closeUtility} />
      ) : null}
      {cartAvailable && cartOpen ? <KioskCartDrawer /> : null}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 }, content: { flex: 1 } });
