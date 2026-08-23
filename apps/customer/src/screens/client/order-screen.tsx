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
import type { Service } from '@/data/catalog';
import type { OrderFulfillment, FulfillmentMode } from '@/features/order/fulfillment';
import { formatMoney } from '@/features/money';
import { PICKUP_WINDOW_MINUTES, describePickupWindow, isWindowStillBookable } from '@/features/order/pickup';
import { orderTotals, pointsForOrder } from '@/features/order/totals';
import { summarizeGiftCardOwnership } from '@/features/gifts/ownership';
import {
  maxRedeemableCents,
  pointsForRedemption,
  splitPayment,
} from '@/features/order/payment-split';
import { HEART_POINTS_LABEL } from '@/features/rewards/presentation';
import { simulateProgress, trackingView } from '@/features/tracking';
import { sizeSuffix } from '@/data/menu-export';
import { tenantFeature } from '@/tenant';
import { newIdempotencyKey } from '@platform/api-client';
import { subscribeToOrderStatus } from '@platform/data';
import type { OrderStatus } from '@platform/schema';
import { REWARD_TIERS, tierForAnnualPoints } from '@/features/rewards/rules';
import { choiceState, disabledState } from '@/lib/a11y-state';
import { platformApi } from '@/lib/api';
import { liveOrderContext } from '@/lib/live-portal';
import { usesSimulatedNativeFlows } from '@/lib/native-adapters';
import { supabase } from '@/lib/supabase';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { useOrder } from '@/state/order-context';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { colors, fonts, radius, shadow, spacing } from '@/theme/tokens';
import type { BookingService } from '@/types/domain';

import { BagStep, NoteStep } from './order/bag-step';
import { CheckoutStep, type CheckoutPaymentMethod } from './order/checkout-step';
import { PlaceStep, DetailsStep } from './order/fulfillment-steps';
import { ItemSheet } from './order/item-sheet';
import { MenuStep } from './order/menu-step';

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
  const [detailItem, setDetailItem] = useState<Service | null>(null);
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
  const [placed, setPlaced] = useState<{ summary: string; totalCents: number; points: number; orderId?: string } | null>(null);
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

  // The idempotency key identifies one CART, not one visit to this screen.
  // It used to be released only on success, so after a request that timed
  // out server-side -- the order written, the response lost -- a guest who
  // added a croissant and pressed Place Order again sent the same key. The
  // server replayed the original order, the app cleared the bag and said
  // "Order placed", and the croissant was never ordered. Anything that
  // changes what is being bought retires the key.
  const cartSignature = JSON.stringify([
    order.cart.lines.map((line) => [line.id, line.quantity, line.unitPriceCents]),
    order.tipCents,
    order.deliveryFeeCents,
    redeemCents,
    order.fulfillment?.mode ?? null,
    order.windowValue,
  ]);
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
            scheduledFor: order.windowValue,
            lines: order.cart.lines.map((line) => ({
              itemSlug: line.itemId,
              sizeSlug: sizeSuffix(line.itemId, line.sizeSlug),
              quantity: line.quantity,
              modifierSlugs: [...line.optionIds],
            })),
            tipCents: order.tipCents,
            note: order.cart.note,
            tenderType: 'pay_at_pickup',
          }, checkoutKey.current);
          checkoutKey.current = null;
          setPlaced({
            summary,
            // The server's math is the order's truth; the client never
            // renders its own totals for a live order.
            totalCents: result.totalCents,
            points: Math.floor(result.subtotalCents / 10),
            orderId: result.orderId,
          });
          order.clearBag();
          order.setTipCents(0);
          setRedeemCents(0);
          setUseGiftBalance(false);
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
    try {
      const service: BookingService = {
        slug: `order-${order.windowValue}`,
        name: summary,
        category: 'specialty',
        durationMin: PICKUP_WINDOW_MINUTES,
        priceCents: totals.totalCents,
        // Paid in full at checkout, so nothing is left owing on the ticket.
        depositCents: totals.totalCents,
        description: order.cart.note || undefined,
      };
      demo.book({ service, addOns: [], placedAt: order.windowValue, fulfillment: order.fulfillment });
      setPlaced({ summary, totalCents: totals.totalCents, points: pointsEarned });
      order.clearBag();
      order.setTipCents(0);
      setRedeemCents(0);
      setUseGiftBalance(false);
      setOverlay('placed');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } finally {
      setPaying(false);
    }
  }, [demo, isDemo, order, pointsEarned, totals.totalCents]);

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

        <PushFromRight visible={overlayAtLeast('checkout')} onDismiss={() => setOverlay('note')}>
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
              pointsName: HEART_POINTS_LABEL,
              onToggle: () => setRedeemCents((current) => (current > 0 ? 0 : redeemableCents)),
            } : null}
            storedValue={giftBalanceCents > 0 ? {
              balanceCents: giftBalanceCents,
              appliedCents: split.storedValueAppliedCents,
              enabled: useGiftBalance,
              onToggle: () => setUseGiftBalance((current) => !current),
            } : null}
            cardChargeCents={split.cardChargeCents}
            onBack={() => setOverlay('note')}
            onTipChange={order.setTipCents}
            onPlaceOrder={placeOrder}
            onManagePayment={() => openMore('payments')}
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
            isDelivery={order.fulfillment.mode === 'delivery'}
            onViewVisits={() => {
              editOrder();
              openMore('visits');
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
  const { width } = useWindowDimensions();
  const compact = width < 360;

  return (
    <CollapsingScreen
      title="Start an Order"
      keyboardShouldPersistTaps="handled"
      style={styles.page}
      headerBackgroundColor={colors.brand200}
      headerBorderColor={colors.brand200}
      contentContainerStyle={[styles.content, compact && styles.contentCompact]}
    >
      <View accessibilityRole="radiogroup" style={[styles.modeRow, compact && styles.modeRowCompact]}>
        <ModeCard
          mode="delivery"
          label="Delivery"
          compact={compact}
          selected={mode === 'delivery'}
          onPress={() => onStart('delivery')}
        />
        <ModeCard
          mode="pickup"
          label="Pickup"
          compact={compact}
          selected={mode === 'pickup'}
          onPress={() => onStart('pickup')}
        />
      </View>

      <HubRow
        icon="person.2"
        title="Catering"
        detail="Coffee cart for your event — message the shop"
        onPress={onOpenCatering}
      />
      <HubRow
        icon="giftcard"
        title="Digital Gift Cards"
        detail="Send a blessing in a few taps."
        onPress={onOpenGift}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Rewards. Earn ${pointsPerDollar} ${HEART_POINTS_LABEL} for every dollar on every order.`}
        onPress={onOpenRewards}
        style={({ pressed }) => [styles.promo, pressed && styles.cardPressed]}
      >
        <View style={styles.promoCopy}>
          <Text style={styles.promoTitle}>Every cup counts</Text>
          <Text style={styles.promoDetail}>
            Earn {pointsPerDollar} {HEART_POINTS_LABEL} for every $1 you spend, then trade them for the
            next one.
          </Text>
        </View>
        <View style={styles.promoMark}>
          <AppIcon name="cup.and.saucer.fill" size={28} tintColor={colors.brand700} />
        </View>
      </Pressable>

      <Body muted>Pickup at the shop on Havana St, or delivery to your door.</Body>
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
        <AppIcon name={icon} size={22} tintColor={colors.brand700} />
      </View>
      <View style={styles.hubCopy}>
        <Text style={styles.hubTitle}>{title}</Text>
        <Text style={styles.hubDetail}>{detail}</Text>
      </View>
      <AppIcon name="chevron.right" size={18} tintColor={colors.ink500} />
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
        <AppIcon name="car.side.fill" size={compact ? 46 : 54} tintColor={colors.brand700} />
      </Animated.View>
    </View>
  );
}

function ShopIllustration({ active, compact }: { active: boolean; compact: boolean }) {
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
        <AppIcon name="cup.and.saucer.fill" size={24} tintColor={colors.brand700} />
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
  isDelivery: boolean;
  onViewVisits: () => void;
  onDone: () => void;
}) {
  const window = describePickupWindow(windowValue, new Date());
  // A live order streams rule-2's states over Realtime; the demo shop makes
  // the drink in front of you on believable delays. Both render the same
  // timeline.
  const [status, setStatus] = useState<OrderStatus>('paid');
  useEffect(() => {
    if (orderId) return subscribeToOrderStatus(supabase, orderId, setStatus);
    return simulateProgress(setStatus);
  }, [orderId]);
  const tracking = trackingView(status);

  // Calling it off is only offered while it is still true: once the shop
  // starts the drink the button disappears rather than failing on tap.
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const canCancel = Boolean(orderId) && (status === 'created' || status === 'paid');
  const onCancel = useCallback(() => {
    if (!orderId || !platformApi) return;
    setCancelling(true);
    setCancelError(null);
    platformApi
      .cancelOrder({ orderId })
      .then(() => setStatus('cancelled'))
      .catch((error: unknown) => {
        setCancelError(error instanceof Error
          ? error.message
          : 'That did not go through. Try again, or ask the shop.');
      })
      .finally(() => setCancelling(false));
  }, [orderId]);
  return (
    <CollapsingScreen
      title="Order placed"
      onBack={onDone}
      backLabel="Order"
      style={styles.page}
      headerBackgroundColor={colors.brand200}
      headerBorderColor={colors.brand200}
      contentContainerStyle={styles.content}
    >
      <View style={styles.placedCard}>
        <View style={styles.placedMark}>
          <AppIcon name="checkmark" size={26} tintColor={colors.white} weight="bold" />
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
          <Text style={styles.placedTotalLabel}>Paid</Text>
          <Text style={styles.placedTotalValue}>{formatMoney(totalCents)}</Text>
        </View>
        <Text style={styles.placedNote}>
          {pointsEarned} {HEART_POINTS_LABEL} land on your account once the shop confirms the order.
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
          <AppIcon name="clock" size={22} tintColor={colors.brand700} />
        </View>
        <View style={styles.hubCopy}>
          <Text style={styles.hubTitle}>See your orders</Text>
          <Text style={styles.hubDetail}>Every order you have placed, with its status.</Text>
        </View>
        <AppIcon name="chevron.right" size={18} tintColor={colors.ink500} />
      </Pressable>
    </CollapsingScreen>
  );
}

const styles = StyleSheet.create({
  cancelBlock: { marginHorizontal: spacing.lg, gap: spacing.xs },
  cancelRow: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.ink200,
    backgroundColor: colors.white,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  cancelText: { color: colors.danger, fontFamily: fonts.sansMedium, fontSize: 15 },
  cancelNote: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 13, textAlign: 'center' },
  cancelError: { color: colors.danger, fontFamily: fonts.sans, fontSize: 13, textAlign: 'center' },
  trackCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing.lg,
    gap: spacing.md,
  },
  trackRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  trackDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 3,
    backgroundColor: colors.ink200,
  },
  trackDotReached: { backgroundColor: colors.success },
  trackDotCurrent: { borderWidth: 3, borderColor: colors.brand200, width: 16, height: 16, borderRadius: 8, marginTop: 1 },
  trackCopy: { flex: 1, gap: 2 },
  trackTitle: { color: colors.ink900, fontFamily: fonts.sansMedium, fontSize: 15 },
  trackMuted: { color: colors.ink500 },
  trackDetail: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 13 },
  page: { backgroundColor: colors.brand200 },
  content: { gap: spacing.lg },
  contentCompact: { paddingHorizontal: spacing.md, gap: spacing.md },
  cardPressed: { transform: [{ scale: 0.975 }] },

  modeRow: { flexDirection: 'row', gap: spacing.md },
  modeRowCompact: { gap: spacing.sm },
  modeCard: {
    flex: 1,
    minHeight: 238,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: colors.white,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shadow.card,
  },
  modeCardCompact: { minHeight: 206, borderRadius: radius.md, padding: spacing.sm },
  modeCardSelected: { borderColor: colors.brand700, backgroundColor: colors.warm },
  modeLabel: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 22, lineHeight: 28 },
  modeLabelCompact: { fontSize: 19, lineHeight: 24 },

  hubRow: {
    minHeight: 76,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand100,
    backgroundColor: colors.brand50,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  hubIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold50,
    borderWidth: 1,
    borderColor: colors.gold300,
  },
  hubCopy: { flex: 1, gap: 3 },
  hubTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  hubDetail: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },

  promo: {
    minHeight: 104,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.gold50,
    borderWidth: 1,
    borderColor: colors.gold300,
  },
  promoCopy: { flex: 1, gap: 4 },
  promoTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 22, lineHeight: 26 },
  promoDetail: { color: colors.ink700, fontFamily: fonts.sans, fontSize: 13, lineHeight: 18 },
  promoMark: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },

  illustration: { flex: 1, width: '100%', minHeight: 154, alignItems: 'center', justifyContent: 'center' },
  illustrationCompact: { minHeight: 132 },
  routeLine: { position: 'absolute', left: 14, right: 14, top: '58%', height: 2, backgroundColor: colors.brand200 },
  routePin: { position: 'absolute', top: '54%', width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand500 },
  routePinStart: { left: 12 },
  routePinEnd: { right: 12 },
  car: { width: 72, height: 58, alignItems: 'center', justifyContent: 'center' },
  shopSign: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold50,
    borderWidth: 1,
    borderColor: colors.gold300,
    marginBottom: -8,
  },
  shopSignCompact: { width: 46, height: 46, borderRadius: 23 },
  shopSignActive: { backgroundColor: colors.brand100, borderColor: colors.brand500 },
  shopBuilding: {
    width: 124,
    minHeight: 94,
    borderWidth: 2,
    borderColor: colors.ink900,
    backgroundColor: colors.warm,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  shopBuildingCompact: { width: 102, minHeight: 84 },
  shopBuildingActive: { backgroundColor: colors.brand50 },
  shopRoof: { height: 22, backgroundColor: colors.brand300, borderBottomWidth: 2, borderBottomColor: colors.ink900 },
  shopWindows: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-evenly', padding: spacing.sm },
  shopWindow: { width: 24, height: 30, borderWidth: 1.5, borderColor: colors.ink900, backgroundColor: colors.white },
  shopDoor: { width: 28, height: 48, borderWidth: 1.5, borderColor: colors.ink900, backgroundColor: colors.brand200 },

  placedCard: { borderRadius: radius.lg, backgroundColor: colors.white, padding: spacing.lg, gap: spacing.sm, ...shadow.card },
  placedMark: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
  },
  placedTitle: { color: colors.ink900, fontFamily: fonts.display, fontSize: 28, lineHeight: 34 },
  placedDetail: { color: colors.ink700, fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },
  placedSummary: { color: colors.ink600, fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 19 },
  placedTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.ink200,
  },
  placedTotalLabel: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 15 },
  placedTotalValue: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18 },
  placedNote: { color: colors.ink600, fontFamily: fonts.sans, fontSize: 12, lineHeight: 18 },
});
