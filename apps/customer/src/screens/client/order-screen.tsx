/**
 * The Order tab.
 *
 * It owns the whole ordering journey as one step machine: the hub, where the
 * order is going, when it is wanted, the menu, the bag, the note and
 * checkout. The steps that cover the tab bar are `PushFromRight` siblings of
 * the tab shell rather than routes, which is how the tab bar keeps its state
 * underneath them — the same arrangement the previous version of this screen
 * used for its one pushed page.
 *
 * The bag itself lives in `state/order-context.tsx`, above the tab shell, so a
 * guest can check their rewards mid-order and come back to a full bag.
 */
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { AppIcon } from '@/components/icon';
import { PushFromRight } from '@/components/push-from-right';
import { Body } from '@/components/ui';
import type { MenuItem } from '@/data/catalog';
import type { OrderFulfillment, FulfillmentMode , OrderableItem } from '@platform/domain';
import {
  formatMoney, fulfillmentDetail, fulfillmentLabel, orderTotals, pointsForOrder,
  REWARD_TIERS, tierForAnnualPoints,
  PICKUP_WINDOW_MINUTES, describePickupWindow, isWindowStillBookable,
} from '@platform/domain';
import {
  checkoutAttemptSignature,
  checkoutGuestLabel,
  completeDemoCardOrder,
  demoConfirmationStatus,
} from '@/features/order/demo-checkout';
import { summarizeGiftCardOwnership } from '@/features/gifts/ownership';
import {
  maxRedeemableCents,
  pointsForRedemption,
  splitPayment,
} from '@/features/order/payment-split';
import { POINTS_LABEL } from '@/features/rewards/presentation';
import { simulateProgress, trackingView } from '@/features/tracking';
import { sizeSuffix } from '@/data/menu-export';
import { TENANT_TAX_JURISDICTIONS, tenantFeature } from '@/tenant';
import { useBusiness } from '@/state/business';
import {
  newIdempotencyKey,
  startSerializedPolling,
  type DemoSyncOrder,
  type PlaceOrderResponse,
} from '@platform/api-client';
import { subscribeToOrderStatus } from '@platform/data';
import type { OrderStatus } from '@platform/schema';
import { choiceState, disabledState, useReducedMotion } from '@platform/ui';
import { platformApi } from '@/lib/api';
import { demoSyncClient } from '@/lib/demo-sync';
import { liveOrderContext } from '@/lib/live-portal';
import { usesSimulatedNativeFlows } from '@/lib/native-adapters';
import { supabase } from '@/lib/supabase';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { useOrder } from '@/state/order-context';

import { BagStep, NoteStep } from './order/bag-step';
import { CheckoutStep, type CheckoutPaymentMethod } from './order/checkout-step';
import { PlaceStep, DetailsStep } from './order/fulfillment-steps';
import { ItemSheet } from './order/item-sheet';
import { MenuStep } from './order/menu-step';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

type SetupStep = 'hub' | 'place' | 'details' | 'menu';
type Overlay = 'none' | 'bag' | 'note' | 'checkout' | 'placed';

/**
 * The overlays, innermost last. A page stays presented while anything above
 * it is open, so going forward slides the next page over the current one and
 * coming back reveals it exactly as it was left -- rather than sliding the
 * old page off to the right at the same moment, briefly exposing the menu
 * between the two, and remounting it scrolled to the top on the way back.
 */
const OVERLAY_STACK: readonly Overlay[] = ['none', 'bag', 'note', 'checkout', 'placed'];

/** The setup pages, stacked the same way. `menu` is not an overlay: it is the
 *  tab screen itself, so reaching it replaces the hub rather than covering it. */
const SETUP_STACK: readonly SetupStep[] = ['hub', 'place', 'details', 'menu'];

export function OrderScreen() {
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
  const pointsPerDollar = tierForAnnualPoints(annualPoints, REWARD_TIERS).pointsPerDollar;
  const pointsEarned = pointsForOrder(totals, annualPoints);

  // Live orders settle at the counter until the brand connects card
  // payments; the demo keeps its saved-card flow.
  const savedCard = (portal.paymentMethods ?? []).find((method) => method.isDefault)
    ?? (portal.paymentMethods ?? [])[0];
  const payment: CheckoutPaymentMethod | null = !isDemo
    ? { kind: 'pay-at-pickup' }
    : savedCard
      ? { kind: 'card', method: savedCard }
      : null;

  const startWith = useCallback((next: FulfillmentMode) => {
    setMode(next);
    setStep('place');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, []);

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
  }, [order]);

  const editOrder = useCallback(() => {
    order.setFulfillment(null);
    setOverlay('none');
    setMode(null);
    setStep('hub');
    setPlaced(null);
    setRedeemCents(0);
    setUseGiftBalance(false);
    placing.current = false;
  }, [order]);

  const placeOrder = useCallback(() => {
    if (placing.current) return;
    if (!order.fulfillment || !order.windowValue || order.isEmpty) return;
    const submittedFulfillment = order.fulfillment;
    const submittedWindowValue = order.windowValue;
    const submittedCart = order.cart;
    const submittedTipCents = order.tipCents;
    const submittedTotals = totals;
    const submittedSignature = cartSignature;
    const submittedGuestLabel = checkoutGuestLabel(guestName);
    const syncClient = demoSyncClient;
    setPayError(null);

    // Re-checked here, not just in the picker: browsing a sixty-item menu
    // easily outlasts the window that was chosen before it, and an order
    // placed against a lapsed one confirms with a time that has been and gone,
    // then files itself under Past orders.
    if (!isWindowStillBookable(order.windowValue, new Date())) {
      setPayError('That pickup time has passed. Choose a new one from the time pill on the menu.');
      order.setWindowValue(null);
      setOverlay('none');
      setStep('details');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }

    const summary = order.cart.lines
      .map((line) => (line.quantity > 1 ? `${line.quantity}× ${line.name}` : line.name))
      .join(', ');

    if (!isDemo) {
      if (order.fulfillment.mode === 'delivery') {
        setPayError('Delivery ordering is coming to live accounts soon — pickup is ready now.');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        return;
      }
      placing.current = true;
      setPaying(true);
      const fulfillment = order.fulfillment;
      void (async () => {
        try {
          if (!supabase || !platformApi) {
            throw new Error('Live ordering is not configured in this build.');
          }
          const context = await liveOrderContext(supabase);
          if (!context) throw new Error('The shop is not accepting orders right now.');
          checkoutKey.current ??= newIdempotencyKey();
          const result = await platformApi.placeOrder({
            locationId: context.locationId,
            fulfillmentType: fulfillment.mode === 'pickup' ? 'pickup' : 'delivery',
            scheduledFor: submittedWindowValue,
            lines: submittedCart.lines.map((line) => ({
              itemSlug: line.itemId,
              sizeSlug: sizeSuffix(line.itemId, line.sizeSlug),
              quantity: line.quantity,
              modifierSlugs: [...line.optionIds],
              ...(line.note ? { note: line.note } : {}),
              ...(line.packContents ? {
                packContents: line.packContents.map((content) => ({
                  itemSlug: content.itemSlug, quantity: content.quantity,
                })),
              } : {}),
            })),
            tipCents: submittedTipCents,
            note: submittedCart.note,
            tenderType: 'pay_at_pickup',
          }, checkoutKey.current);
          checkoutKey.current = null;
          setPlaced({
            summary,
            // The server's math is the order's truth; the client never
            // renders its own totals for a live order.
            totalCents: result.totalCents,
            points: Math.floor(result.subtotalCents / 10),
            status: result.status,
            orderId: result.orderId,
          });
          if (cartSignatureRef.current === submittedSignature) {
            order.clearBag();
            order.setTipCents(0);
            setRedeemCents(0);
            setUseGiftBalance(false);
          }
          setOverlay('placed');
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        } catch (placeError) {
          setPayError(placeError instanceof Error ? placeError.message : 'The order could not be placed.');
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        } finally {
          placing.current = false;
          setPaying(false);
        }
      })();
      return;
    }

    placing.current = true;
    setPaying(true);
    void (async () => {
      try {
        let syncedOrder: PlaceOrderResponse | null = null;
        let sharedOrder: DemoSyncOrder | null = null;
        if (syncClient) {
          checkoutKey.current ??= newIdempotencyKey();
          syncedOrder = await syncClient.placeOrder({
            locationId: 'demo', fulfillmentType: submittedFulfillment.mode,
            scheduledFor: submittedWindowValue,
            lines: submittedCart.lines.map((line) => ({
              itemSlug: line.itemId, sizeSlug: sizeSuffix(line.itemId, line.sizeSlug),
              quantity: line.quantity, modifierSlugs: [...line.optionIds],
              ...(line.note ? { note: line.note } : {}),
              ...(line.packContents ? {
                packContents: line.packContents.map((content) => ({
                  itemSlug: content.itemSlug, quantity: content.quantity,
                })),
              } : {}),
            })),
            tipCents: submittedTipCents, maximumTotalCents: submittedTotals.totalCents,
            note: submittedCart.note, tenderType: 'square_card', guestLabel: submittedGuestLabel,
          }, checkoutKey.current);
          sharedOrder = await completeDemoCardOrder(syncClient, syncedOrder);
          syncedOrder = { ...syncedOrder, status: sharedOrder.status };
          checkoutKey.current = null;
        }
        if (syncedOrder && sharedOrder) {
          demo.bookSynced({
            id: syncedOrder.orderId,
            demoSyncSessionId: sharedOrder.sessionId,
            status: sharedOrder.status,
            summary,
            lines: submittedCart.lines.map((line) => ({
              name: line.name,
              quantity: line.quantity,
              unitPriceCents: line.unitPriceCents,
              options: line.optionSummary ? [line.optionSummary] : [],
              ...(line.packContents ? {
                packContents: line.packContents.map((content) => ({
                  name: content.name, quantity: content.quantity,
                })),
              } : {}),
            })),
            fulfillmentType: submittedFulfillment.mode,
            scheduledFor: sharedOrder.scheduledFor,
            placedAt: sharedOrder.placedAt,
            subtotalCents: syncedOrder.subtotalCents,
            taxCents: syncedOrder.taxCents,
            tipCents: syncedOrder.tipCents,
            totalCents: syncedOrder.totalCents,
            note: submittedCart.note,
            ...(submittedGuestLabel ? { guestLabel: submittedGuestLabel } : {}),
            locationLabel: fulfillmentLabel(submittedFulfillment),
            locationDetail: fulfillmentDetail(submittedFulfillment),
          });
        } else {
          const item: OrderableItem = {
            slug: `order-${submittedWindowValue}`, name: summary, category: 'specialty',
            durationMin: PICKUP_WINDOW_MINUTES, priceCents: submittedTotals.totalCents,
            depositCents: submittedTotals.totalCents, description: submittedCart.note || undefined,
          };
          demo.book({ item, addOns: [], placedAt: submittedWindowValue, fulfillment: submittedFulfillment });
        }
        setPlaced({
          summary, totalCents: syncedOrder?.totalCents ?? submittedTotals.totalCents,
          points: pointsEarned, status: syncedOrder?.status ?? 'paid',
          ...(syncedOrder && sharedOrder ? {
            orderId: syncedOrder.orderId,
            demoSynced: true,
            demoSyncSessionId: sharedOrder.sessionId,
          } : {}),
        });
        if (cartSignatureRef.current === submittedSignature) {
          order.clearBag(); order.setTipCents(0); setRedeemCents(0); setUseGiftBalance(false);
        }
        setOverlay('placed');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      } catch (error) {
        setPayError(error instanceof Error ? error.message : 'The shared demo could not place the order.');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      } finally {
        placing.current = false;
        setPaying(false);
      }
    })();
  }, [cartSignature, demo, guestName, isDemo, order, pointsEarned, totals]);

  // The web tab bar hides while a covering page is up (see app-context).
  // hub and menu keep the bar, exactly like native.
  useEffect(() => {
    setBarCovered(step === 'place' || step === 'details' || overlay !== 'none');
    return () => setBarCovered(false);
  }, [overlay, setBarCovered, step]);

  const overlayAtLeast = (level: Overlay) =>
    OVERLAY_STACK.indexOf(overlay) >= OVERLAY_STACK.indexOf(level);
  const setupAtLeast = (level: SetupStep) =>
    SETUP_STACK.indexOf(step) >= SETUP_STACK.indexOf(level);

  // Keyed on the flow's own step. Keying it on `order.windowValue` meant
  // tapping a time chip unmounted the whole Details step mid-flow: the menu
  // appeared instantly, the sticky "See the menu" button and the name
  // validation behind it were unreachable, and a mis-tapped time could not be
  // corrected without going back through the menu's own time pill.
  if (step === 'menu' && order.fulfillment && order.windowValue) {
    return (
      <>
        <MenuStep
          fulfillment={order.fulfillment}
          windowValue={order.windowValue}
          itemCount={order.itemCount}
          subtotalCents={order.subtotalCents}
          highlightItemId={selectedServiceId}
          onBack={editOrder}
          onEdit={() => {
            setMode(order.fulfillment?.mode ?? null);
            setStep('details');
          }}
          onSelectItem={setDetailItem}
          onOpenBag={() => setOverlay('bag')}
        />

        <ItemSheet
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onAdd={(line) => {
            const added = order.addLine(line);
            // The sheet stays open and explains itself when the bag could not
            // take everything the button quoted.
            if (added === line.quantity) setDetailItem(null);
            return added;
          }}
        />

        <PushFromRight visible={overlayAtLeast('bag')} onDismiss={() => setOverlay('none')}>
          <BagStep
            cart={order.cart}
            fulfillment={order.fulfillment}
            windowValue={order.windowValue}
            subtotalCents={order.subtotalCents}
            pointsPerDollar={pointsPerDollar}
            onBack={() => setOverlay('none')}
            onEdit={editOrder}
            onChangeQuantity={order.changeQuantity}
            onCheckout={() => setOverlay('note')}
          />
        </PushFromRight>

        <PushFromRight visible={overlayAtLeast('note')} onDismiss={() => setOverlay('bag')}>
          <NoteStep
            note={order.cart.note}
            onBack={() => setOverlay('bag')}
            onChangeNote={order.setNote}
            onDone={() => setOverlay('checkout')}
          />
        </PushFromRight>

        <PushFromRight
          visible={overlayAtLeast('checkout')}
          dismissDisabled={paying}
          onDismiss={() => { if (!paying) setOverlay('note'); }}
        >
          <CheckoutStep
            totals={totals}
            pointsEarned={pointsEarned}
            payment={payment}
            paymentLoading={demo.isHydrating}
            paying={paying}
            simulated={simulated}
            error={payError}
            // Point redemption applies at checkout in Demo only; live points
            // buy catalog rewards on the Rewards tab until the order API
            // carries a points-to-cents rule.
            redeem={isDemo && (redeemableCents > 0 || redeemCents > 0) ? {
              availableCents: redeemableCents,
              appliedCents: redeemCents,
              pointsCharged: pointsForRedemption(redeemCents),
              pointsName: POINTS_LABEL,
              onToggle: () => { if (!paying) setRedeemCents((current) => (current > 0 ? 0 : redeemableCents)); },
            } : null}
            storedValue={giftBalanceCents > 0 ? {
              balanceCents: giftBalanceCents,
              appliedCents: split.storedValueAppliedCents,
              enabled: useGiftBalance,
              onToggle: () => { if (!paying) setUseGiftBalance((current) => !current); },
            } : null}
            cardChargeCents={split.cardChargeCents}
            onBack={() => { if (!paying) setOverlay('note'); }}
            onTipChange={(cents) => { if (!paying) order.setTipCents(cents); }}
            onPlaceOrder={placeOrder}
            onManagePayment={() => { if (!paying) openMore('payments'); }}
          />
        </PushFromRight>

        <PushFromRight visible={overlayAtLeast('placed')} onDismiss={editOrder}>
          <OrderPlaced
            summary={placed?.summary ?? ''}
            guestName={guestName}
            windowValue={order.windowValue}
            totalCents={placed?.totalCents ?? 0}
            pointsEarned={placed?.points ?? 0}
            orderId={placed?.orderId ?? null}
            demoSynced={placed?.demoSynced === true}
            demoSyncSessionId={placed?.demoSyncSessionId ?? null}
            initialStatus={placed?.status ?? 'paid'}
            isDelivery={order.fulfillment.mode === 'delivery'}
            onViewVisits={() => {
              editOrder();
              openMore('orders');
            }}
            onDone={editOrder}
          />
        </PushFromRight>
      </>
    );
  }

  return (
    <>
      <OrderHub
        mode={mode}
        onStart={startWith}
        onOpenGift={() => setClientTab('gift')}
        onOpenCatering={() => openMore('messages')}
        onOpenRewards={() => setClientTab('rewards')}
        pointsPerDollar={pointsPerDollar}
      />

      <PushFromRight visible={setupAtLeast('place')} onDismiss={() => setStep('hub')}>
        {mode ? (
          <PlaceStep
            mode={mode}
            isDemo={isDemo}
            // Without this the form remounts empty every time it is reopened,
            // so editing a delivery order meant retyping the whole address --
            // an address the menu pill was displaying one tap earlier.
            initialAddress={order.fulfillment?.mode === 'delivery' ? order.fulfillment.address : undefined}
            onBack={() => setStep('hub')}
            onChoose={choosePlace}
          />
        ) : null}
      </PushFromRight>

      <PushFromRight visible={setupAtLeast('details')} onDismiss={() => setStep('place')}>
        {mode ? (
          <DetailsStep
            mode={mode}
            guestName={guestName}
            windowValue={order.windowValue}
            now={new Date()}
            onBack={() => setStep('place')}
            onChangeName={order.setGuestName}
            onChangeWindow={order.setWindowValue}
            onDone={() => setStep('menu')}
          />
        ) : null}
      </PushFromRight>
    </>
  );
}

/* -------------------------------------------------------------------- hub */

function OrderHub({
  mode,
  onStart,
  onOpenGift,
  onOpenCatering,
  onOpenRewards,
  pointsPerDollar,
}: {
  mode: FulfillmentMode | null;
  onStart: (mode: FulfillmentMode) => void;
  onOpenGift: () => void;
  onOpenCatering: () => void;
  onOpenRewards: () => void;
  pointsPerDollar: number;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const business = useBusiness();
  const { width } = useWindowDimensions();
  const compact = width < 360;
  // Rule 5: these three are brand flags, and the hub offered all three to
  // everyone. A shop with delivery off still showed a Delivery card that
  // started a flow it cannot fulfil, and one without stored value still
  // offered gift cards -- the balance was already gated, the entry point
  // was not. They are all on for the launch tenant, so nothing moves here
  // until the second brand, which is exactly when it would have hurt.
  const deliveryEnabled = tenantFeature('delivery');

  return (
    <CollapsingScreen
      title="Start an Order"
      keyboardShouldPersistTaps="handled"
      style={styles.page}
      headerBackgroundColor={tokens.surface}
      headerBorderColor={tokens.surface}
      contentContainerStyle={[styles.content, compact && styles.contentCompact]}
    >
      <View accessibilityRole="radiogroup" style={[styles.modeRow, compact && styles.modeRowCompact]}>
        {deliveryEnabled ? (
          <ModeCard
            mode="delivery"
            label="Delivery"
            compact={compact}
            selected={mode === 'delivery'}
            onPress={() => onStart('delivery')}
          />
        ) : null}
        <ModeCard
          mode="pickup"
          label="Pickup"
          compact={compact}
          selected={mode === 'pickup'}
          onPress={() => onStart('pickup')}
        />
      </View>

      {tenantFeature('catering') ? (
        <HubRow
          icon="person.2"
          title="Catering"
          detail="Coffee cart for your event — message the shop"
          onPress={onOpenCatering}
        />
      ) : null}
      {tenantFeature('stored_value') ? (
        <HubRow
          icon="giftcard"
          title="Digital Gift Cards"
          detail="Send a blessing in a few taps."
          onPress={onOpenGift}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Rewards. Earn ${pointsPerDollar} ${POINTS_LABEL} for every dollar on every order.`}
        onPress={onOpenRewards}
        style={({ pressed }) => [styles.promo, pressed && styles.cardPressed]}
      >
        <View style={styles.promoCopy}>
          <Text style={styles.promoTitle}>Every cup counts</Text>
          <Text style={styles.promoDetail}>
            Earn {pointsPerDollar} {POINTS_LABEL} for every $1 you spend, then trade them for the
            next one.
          </Text>
        </View>
        <View style={styles.promoMark}>
          <AppIcon name="cup.and.saucer.fill" size={28} tintColor={tokens.primary} />
        </View>
      </Pressable>

      <Body muted>
        Pickup at {business.street}{deliveryEnabled ? ', or delivery to your door' : ''}.
      </Body>
    </CollapsingScreen>
  );
}

function HubRow({
  icon,
  title,
  detail,
  onPress,
}: {
  icon: 'person.2' | 'giftcard';
  title: string;
  detail: string;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [styles.hubRow, pressed && styles.cardPressed]}
    >
      <View style={styles.hubIcon}>
        <AppIcon name={icon} size={22} tintColor={tokens.primary} />
      </View>
      <View style={styles.hubCopy}>
        <Text style={styles.hubTitle}>{title}</Text>
        <Text style={styles.hubDetail}>{detail}</Text>
      </View>
      <AppIcon name="chevron.right" size={18} tintColor={tokens.textMuted} />
    </Pressable>
  );
}

type ModeCardProps = {
  mode: FulfillmentMode;
  label: string;
  compact: boolean;
  selected: boolean;
  onPress: () => void;
};

function ModeCard({ mode, label, compact, selected, onPress }: ModeCardProps) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${label} order`}
      {...choiceState(selected)}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeCard,
        compact && styles.modeCardCompact,
        selected && styles.modeCardSelected,
        pressed && styles.cardPressed,
      ]}
    >
      {mode === 'delivery'
        ? <DispatchIllustration active={selected} compact={compact} />
        : <ShopIllustration active={selected} compact={compact} />}
      <Text style={[styles.modeLabel, compact && styles.modeLabelCompact]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Both illustrations loop a small idle animation. They used to re-implement
 * `useReducedMotion` inline, once each; they now share the hook every other
 * animated surface in the app uses.
 */
function useIdleLoop(durationMs: number, restingValue: number) {
  const reducedMotion = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (reducedMotion) {
      progress.stopAnimation();
      progress.setValue(restingValue);
      return undefined;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: durationMs, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: durationMs, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [durationMs, progress, reducedMotion, restingValue]);

  return progress;
}

function DispatchIllustration({ active, compact }: { active: boolean; compact: boolean }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const progress = useIdleLoop(2400, 0.55);
  const carStyle = {
    opacity: active ? 1 : 0.72,
    transform: [
      { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-42, 42] }) },
      { translateY: progress.interpolate({ inputRange: [0, 0.45, 1], outputRange: [2, -4, 2] }) },
    ],
  };
  return (
    <View style={[styles.illustration, compact && styles.illustrationCompact]}>
      <View style={styles.routeLine} />
      <View style={[styles.routePin, styles.routePinStart]} />
      <View style={[styles.routePin, styles.routePinEnd]} />
      <Animated.View style={[styles.car, carStyle]}>
        <AppIcon name="car.side.fill" size={compact ? 46 : 54} tintColor={tokens.primary} />
      </Animated.View>
    </View>
  );
}

function ShopIllustration({ active, compact }: { active: boolean; compact: boolean }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const progress = useIdleLoop(2000, 0);
  const steamStyle = {
    opacity: active ? 1 : 0.8,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -7, 0] }) },
      { scale: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.06, 1] }) },
    ],
  };
  return (
    <View style={[styles.illustration, compact && styles.illustrationCompact]}>
      <Animated.View style={[styles.shopSign, compact && styles.shopSignCompact, active && styles.shopSignActive, steamStyle]}>
        <AppIcon name="cup.and.saucer.fill" size={24} tintColor={tokens.primary} />
      </Animated.View>
      <View style={[styles.shopBuilding, compact && styles.shopBuildingCompact, active && styles.shopBuildingActive]}>
        <View style={styles.shopRoof} />
        <View style={styles.shopWindows}>
          <View style={styles.shopWindow} />
          <View style={styles.shopDoor} />
          <View style={styles.shopWindow} />
        </View>
      </View>
    </View>
  );
}

/* ----------------------------------------------------------- confirmation */

function OrderPlaced({
  summary,
  guestName,
  windowValue,
  totalCents,
  pointsEarned,
  orderId,
  demoSynced,
  demoSyncSessionId,
  initialStatus,
  isDelivery,
  onViewVisits,
  onDone,
}: {
  summary: string;
  guestName: string;
  windowValue: string;
  totalCents: number;
  pointsEarned: number;
  /** Present for live orders: drives realtime tracking instead of the simulator. */
  orderId: string | null;
  demoSynced: boolean;
  demoSyncSessionId: string | null;
  initialStatus: OrderStatus;
  isDelivery: boolean;
  onViewVisits: () => void;
  onDone: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const window = describePickupWindow(windowValue, new Date());
  // A live order streams rule-2's states over Realtime; the demo shop makes
  // the drink in front of you on believable delays. Both render the same
  // timeline.
  const [status, setStatus] = useState<OrderStatus>(initialStatus);
  useEffect(() => {
    const syncClient = demoSyncClient;
    if (orderId && demoSynced && demoSyncSessionId && syncClient) {
      let active = true;
      const stop = startSerializedPolling(async () => {
        const snapshot = await syncClient.orders();
        if (active) {
          setStatus((current) => demoConfirmationStatus(
            current, orderId, demoSyncSessionId, snapshot,
          ));
        }
      }, 1_000);
      return () => { active = false; stop(); };
    }
    if (orderId) return subscribeToOrderStatus(supabase, orderId, setStatus);
    return simulateProgress(setStatus);
  }, [demoSyncSessionId, demoSynced, orderId]);
  const tracking = trackingView(status);

  // Calling it off is only offered while it is still true: once the shop
  // starts the drink the button disappears rather than failing on tap.
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const canCancel = Boolean(orderId) && status === 'created';
  const onCancel = useCallback(() => {
    if (!orderId) return;
    setCancelling(true);
    setCancelError(null);
    const cancellation = demoSynced && demoSyncClient
      ? demoSyncClient.transition(orderId, 'cancelled')
      : platformApi?.cancelOrder({ orderId });
    if (!cancellation) {
      setCancelling(false);
      setCancelError('Cancellation is not configured.');
      return;
    }
    cancellation
      .then(() => setStatus('cancelled'))
      .catch((error: unknown) => {
        setCancelError(error instanceof Error
          ? error.message
          : 'That did not go through. Try again, or ask the shop.');
      })
      .finally(() => setCancelling(false));
  }, [demoSynced, orderId]);
  return (
    <CollapsingScreen
      title="Order placed"
      onBack={onDone}
      backLabel="Order"
      style={styles.page}
      headerBackgroundColor={tokens.surface}
      headerBorderColor={tokens.surface}
      contentContainerStyle={styles.content}
    >
      <View style={styles.placedCard}>
        <View style={styles.placedMark}>
          <AppIcon name="checkmark" size={26} tintColor={tokens.surfaceElevated} weight="bold" />
        </View>
        <Text style={styles.placedTitle}>
          {isDelivery ? 'On its way' : 'We’ll have it ready'}
        </Text>
        <Text style={styles.placedDetail}>
          {window
            ? `${isDelivery ? 'Delivering' : 'Ready for'} ${guestName || 'you'} ${window.dayLabel.toLowerCase()}, ${window.timeLabel}.`
            : `Thanks, ${guestName || 'friend'}.`}
        </Text>
        {summary ? <Text style={styles.placedSummary}>{summary}</Text> : null}
        <View style={styles.placedTotalRow}>
          <Text style={styles.placedTotalLabel}>{status === 'created' ? 'Due at counter' : 'Paid'}</Text>
          <Text style={styles.placedTotalValue}>{formatMoney(totalCents)}</Text>
        </View>
        <Text style={styles.placedNote}>
          {pointsEarned} {POINTS_LABEL} land on your account once the shop confirms the order.
        </Text>
      </View>

      <View accessibilityLiveRegion="polite" style={styles.trackCard}>
        {tracking.steps.map((step, index) => {
          const reached = tracking.activeIndex >= index;
          const current = tracking.activeIndex === index;
          return (
            <View key={step.status} style={styles.trackRow}>
              <View style={[styles.trackDot, reached && styles.trackDotReached, current && styles.trackDotCurrent]} />
              <View style={styles.trackCopy}>
                <Text style={[styles.trackTitle, !reached && styles.trackMuted]}>{step.title}</Text>
                {current ? <Text style={styles.trackDetail}>{step.detail}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>

      {canCancel ? (
        <View style={styles.cancelBlock}>
          {cancelError ? <Text style={styles.cancelError}>{cancelError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel this order"
            disabled={cancelling}
            {...disabledState(cancelling)}
            onPress={onCancel}
            style={({ pressed }) => [styles.cancelRow, pressed && styles.cardPressed]}
          >
            <Text style={styles.cancelText}>
              {cancelling ? 'Cancelling…' : 'Cancel this order'}
            </Text>
          </Pressable>
          <Text style={styles.cancelNote}>
            You can cancel until the shop starts making it.
          </Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        onPress={onViewVisits}
        style={({ pressed }) => [styles.hubRow, pressed && styles.cardPressed]}
      >
        <View style={styles.hubIcon}>
          <AppIcon name="clock" size={22} tintColor={tokens.primary} />
        </View>
        <View style={styles.hubCopy}>
          <Text style={styles.hubTitle}>See your orders</Text>
          <Text style={styles.hubDetail}>Every order you have placed, with its status.</Text>
        </View>
        <AppIcon name="chevron.right" size={18} tintColor={tokens.textMuted} />
      </Pressable>
    </CollapsingScreen>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  cancelBlock: { marginHorizontal: tokens.spacing.xl, gap: tokens.spacing.sm },
  cancelRow: {
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.secondary,
    backgroundColor: tokens.surfaceElevated,
    paddingVertical: tokens.spacing.lg,
    alignItems: 'center',
  },
  cancelText: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 15 },
  cancelNote: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13, textAlign: 'center' },
  cancelError: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13, textAlign: 'center' },
  trackCard: {
    marginHorizontal: tokens.spacing.xl,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surfaceElevated,
    padding: tokens.spacing.xl,
    gap: tokens.spacing.lg,
  },
  trackRow: { flexDirection: 'row', gap: tokens.spacing.lg, alignItems: 'flex-start' },
  trackDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 3,
    backgroundColor: tokens.secondary,
  },
  trackDotReached: { backgroundColor: tokens.success },
  trackDotCurrent: { borderWidth: 3, borderColor: tokens.surface, width: 16, height: 16, borderRadius: 8, marginTop: 1 },
  trackCopy: { flex: 1, gap: 2 },
  trackTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  trackMuted: { color: tokens.textMuted },
  trackDetail: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13 },
  page: { backgroundColor: tokens.surface },
  content: { gap: tokens.spacing.xl },
  contentCompact: { paddingHorizontal: tokens.spacing.lg, gap: tokens.spacing.lg },
  cardPressed: { transform: [{ scale: 0.975 }] },

  modeRow: { flexDirection: 'row', gap: tokens.spacing.lg },
  modeRowCompact: { gap: tokens.spacing.md },
  modeCard: {
    flex: 1,
    minHeight: 238,
    borderRadius: tokens.radius.lg,
    borderWidth: 2,
    borderColor: tokens.surfaceElevated,
    backgroundColor: tokens.surfaceElevated,
    padding: tokens.spacing.lg,
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: tokens.textPrimary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: tokens.elevation.card, shadowRadius: 24, elevation: 5,
  },
  modeCardCompact: { minHeight: 206, borderRadius: tokens.radius.lg, padding: tokens.spacing.md },
  modeCardSelected: { borderColor: tokens.primary, backgroundColor: tokens.surface },
  modeLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 22, lineHeight: 28 },
  modeLabelCompact: { fontSize: 19, lineHeight: 24 },

  hubRow: {
    minHeight: 76,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.surface,
    backgroundColor: tokens.surface,
    paddingHorizontal: tokens.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.lg,
  },
  hubIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.surface,
    borderWidth: 1,
    borderColor: tokens.accent,
  },
  hubCopy: { flex: 1, gap: 3 },
  hubTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  hubDetail: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, lineHeight: 17 },

  promo: {
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.lg,
    padding: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
    borderWidth: 1,
    borderColor: tokens.accent,
  },
  promoCopy: { flex: 1, gap: 4 },
  promoTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 22, lineHeight: 26 },
  promoDetail: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 18 },
  promoMark: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.surfaceElevated,
  },

  illustration: { flex: 1, width: '100%', minHeight: 154, alignItems: 'center', justifyContent: 'center' },
  illustrationCompact: { minHeight: 132 },
  routeLine: { position: 'absolute', left: 14, right: 14, top: '58%', height: 2, backgroundColor: tokens.surface },
  routePin: { position: 'absolute', top: '54%', width: 10, height: 10, borderRadius: 5, backgroundColor: tokens.secondary },
  routePinStart: { left: 12 },
  routePinEnd: { right: 12 },
  car: { width: 72, height: 58, alignItems: 'center', justifyContent: 'center' },
  shopSign: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.surface,
    borderWidth: 1,
    borderColor: tokens.accent,
    marginBottom: -8,
  },
  shopSignCompact: { width: 46, height: 46, borderRadius: 23 },
  shopSignActive: { backgroundColor: tokens.surface, borderColor: tokens.secondary },
  shopBuilding: {
    width: 124,
    minHeight: 94,
    borderWidth: 2,
    borderColor: tokens.textPrimary,
    backgroundColor: tokens.surface,
    borderRadius: tokens.radius.md,
    overflow: 'hidden',
  },
  shopBuildingCompact: { width: 102, minHeight: 84 },
  shopBuildingActive: { backgroundColor: tokens.surface },
  shopRoof: { height: 22, backgroundColor: tokens.secondary, borderBottomWidth: 2, borderBottomColor: tokens.textPrimary },
  shopWindows: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-evenly', padding: tokens.spacing.md },
  shopWindow: { width: 24, height: 30, borderWidth: 1.5, borderColor: tokens.textPrimary, backgroundColor: tokens.surfaceElevated },
  shopDoor: { width: 28, height: 48, borderWidth: 1.5, borderColor: tokens.textPrimary, backgroundColor: tokens.surface },

  placedCard: { borderRadius: tokens.radius.lg, backgroundColor: tokens.surfaceElevated, padding: tokens.spacing.xl, gap: tokens.spacing.md, shadowColor: tokens.textPrimary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: tokens.elevation.card, shadowRadius: 24, elevation: 5 },
  placedMark: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.success,
  },
  placedTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 28, lineHeight: 34 },
  placedDetail: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15, lineHeight: 22 },
  placedSummary: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 19 },
  placedTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: tokens.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.secondary,
  },
  placedTotalLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  placedTotalValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 18 },
  placedNote: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12, lineHeight: 18 },
});
