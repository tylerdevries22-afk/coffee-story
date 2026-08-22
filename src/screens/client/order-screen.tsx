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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { AppIcon } from '@/components/icon';
import { PushFromRight } from '@/components/push-from-right';
import { SiriAssistant, type SiriCommand } from '@/components/siri/siri-assistant';
import { Body } from '@/components/ui';
import type { Service } from '@/data/catalog';
import type { BookingFulfillment, VisitMode } from '@/features/booking/fulfillment';
import { formatMoney } from '@/features/money';
import { PICKUP_WINDOW_MINUTES, describePickupWindow } from '@/features/order/pickup';
import { orderTotals, pointsForOrder } from '@/features/order/totals';
import { HEART_POINTS_LABEL } from '@/features/rewards/presentation';
import { REWARD_TIERS, tierForAnnualPoints } from '@/features/rewards/rules';
import { choiceState } from '@/lib/a11y-state';
import { usesSimulatedNativeFlows } from '@/lib/native-adapters';
import { useStripe } from '@/lib/stripe';
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

type SetupStep = 'hub' | 'place' | 'details';
type Overlay = 'none' | 'bag' | 'note' | 'checkout' | 'placed';

export function OrderScreen() {
  const { isDemo, portal } = useAuth();
  const demo = useDemo();
  const order = useOrder();
  const stripe = useStripe();
  const { selectedServiceId, setClientTab, openMore } = useAppState();

  const [mode, setMode] = useState<VisitMode | null>(null);
  const [step, setStep] = useState<SetupStep>('hub');
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [detailItem, setDetailItem] = useState<Service | null>(null);
  const [applePaySupported, setApplePaySupported] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [placedSummary, setPlacedSummary] = useState<string | null>(null);

  const simulated = usesSimulatedNativeFlows(isDemo, Constants.appOwnership ?? null);
  const guestName = order.guestName || portal.profile.fullName;

  const totals = useMemo(() => orderTotals({
    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    tipCents: order.tipCents,
  }), [order.deliveryFeeCents, order.subtotalCents, order.tipCents]);

  const annualPoints = portal.rewardAccount.annualPoints;
  const pointsPerDollar = tierForAnnualPoints(annualPoints, REWARD_TIERS).pointsPerDollar;
  const pointsEarned = pointsForOrder(totals, annualPoints);

  // Only ask the platform once a real Stripe module is present. In Expo Go and
  // in Demo mode there is no native Stripe, and the question would throw.
  useEffect(() => {
    if (simulated) return undefined;
    const probe = stripe.isPlatformPaySupported?.();
    if (!probe) return undefined;
    let active = true;
    void probe
      .then((supported: boolean) => {
        if (active) setApplePaySupported(supported);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [simulated, stripe]);

  const savedCard = (portal.paymentMethods ?? []).find((method) => method.isDefault)
    ?? (portal.paymentMethods ?? [])[0];
  const payment: CheckoutPaymentMethod | null = applePaySupported
    ? { kind: 'apple-pay' }
    : savedCard
      ? { kind: 'card', method: savedCard }
      : null;

  const startWith = useCallback((next: VisitMode) => {
    setMode(next);
    setStep('place');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }, []);

  const choosePlace = useCallback((fulfillment: BookingFulfillment) => {
    order.setFulfillment(fulfillment);
    setStep('details');
  }, [order]);

  const editOrder = useCallback(() => {
    order.setFulfillment(null);
    setOverlay('none');
    setMode(null);
    setStep('hub');
  }, [order]);

  const placeOrder = useCallback(() => {
    if (!order.fulfillment || !order.windowValue) return;
    setPayError(null);

    if (!isDemo) {
      setPayError(
        simulated
          ? 'Expo Go cannot take a real card. Switch to Demo from More to walk the whole order through.'
          : 'Menu orders need the shop’s order endpoint before a card can be charged. Nothing was charged.',
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }

    setPaying(true);
    try {
      const summary = order.cart.lines
        .map((line) => (line.quantity > 1 ? `${line.quantity}× ${line.name}` : line.name))
        .join(', ');
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
      demo.book({ service, addOns: [], startsAt: order.windowValue, fulfillment: order.fulfillment });
      setPlacedSummary(summary);
      order.clearBag();
      order.setTipCents(0);
      setOverlay('placed');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } finally {
      setPaying(false);
    }
  }, [demo, isDemo, order, simulated, totals.totalCents]);

  if (order.fulfillment && order.windowValue) {
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
            order.setWindowValue(null);
          }}
          onSelectItem={setDetailItem}
          onOpenBag={() => setOverlay('bag')}
        />

        <ItemSheet
          item={detailItem}
          onClose={() => setDetailItem(null)}
          onAdd={(line) => {
            order.addLine(line);
            setDetailItem(null);
          }}
        />

        <PushFromRight visible={overlay === 'bag'} onDismiss={() => setOverlay('none')}>
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

        <PushFromRight visible={overlay === 'note'} onDismiss={() => setOverlay('bag')}>
          <NoteStep
            note={order.cart.note}
            onBack={() => setOverlay('bag')}
            onChangeNote={order.setNote}
            onDone={() => setOverlay('checkout')}
          />
        </PushFromRight>

        <PushFromRight visible={overlay === 'checkout'} onDismiss={() => setOverlay('bag')}>
          <CheckoutStep
            totals={totals}
            pointsEarned={pointsEarned}
            payment={payment}
            paymentLoading={demo.isHydrating}
            paying={paying}
            simulated={simulated}
            error={payError}
            onBack={() => setOverlay('bag')}
            onTipChange={order.setTipCents}
            onPlaceOrder={placeOrder}
            onManagePayment={() => openMore('payments')}
          />
        </PushFromRight>

        <PushFromRight visible={overlay === 'placed'} onDismiss={editOrder}>
          <OrderPlaced
            summary={placedSummary ?? ''}
            guestName={guestName}
            windowValue={order.windowValue}
            totalCents={totals.totalCents}
            pointsEarned={pointsEarned}
            isDelivery={order.fulfillment.mode === 'dispatch'}
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

      <PushFromRight visible={step === 'place'} onDismiss={() => setStep('hub')}>
        {mode ? (
          <PlaceStep
            mode={mode}
            isDemo={isDemo}
            onBack={() => setStep('hub')}
            onChoose={choosePlace}
          />
        ) : null}
      </PushFromRight>

      <PushFromRight visible={step === 'details'} onDismiss={() => setStep('place')}>
        {mode ? (
          <DetailsStep
            mode={mode}
            guestName={guestName}
            windowValue={order.windowValue}
            now={new Date()}
            onBack={() => setStep('place')}
            onChangeName={order.setGuestName}
            onChangeWindow={order.setWindowValue}
            onDone={() => setStep('hub')}
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
  mode: VisitMode | null;
  onStart: (mode: VisitMode) => void;
  onOpenGift: () => void;
  onOpenCatering: () => void;
  onOpenRewards: () => void;
  pointsPerDollar: number;
}) {
  const [showAssistant, setShowAssistant] = useState(true);
  const { width } = useWindowDimensions();
  const { startBooking, openMore, setClientTab } = useAppState();
  const compact = width < 360;
  const siriCommands: readonly SiriCommand[] = [
    { key: 'book', phrase: 'Order my usual', onRun: () => startBooking() },
    { key: 'next-visit', phrase: 'When is my next pickup?', onRun: () => openMore('visits') },
    { key: 'rewards', phrase: 'Check my rewards balance', onRun: () => setClientTab('rewards') },
    { key: 'gift', phrase: 'Send a gift card', onRun: () => setClientTab('gift') },
  ];

  return (
    <CollapsingScreen
      title="Start an Order"
      keyboardShouldPersistTaps="handled"
      style={styles.page}
      headerBackgroundColor={colors.brand200}
      headerBorderColor={colors.brand200}
      contentContainerStyle={[styles.content, compact && styles.contentCompact]}
    >
      {showAssistant ? <SiriAssistant commands={siriCommands} onClose={() => setShowAssistant(false)} /> : null}

      <View accessibilityRole="radiogroup" style={[styles.modeRow, compact && styles.modeRowCompact]}>
        <ModeCard
          mode="dispatch"
          label="Delivery"
          compact={compact}
          selected={mode === 'dispatch'}
          onPress={() => onStart('dispatch')}
        />
        <ModeCard
          mode="office"
          label="Pickup"
          compact={compact}
          selected={mode === 'office'}
          onPress={() => onStart('office')}
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
  mode: VisitMode;
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
      {mode === 'dispatch'
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
  isDelivery,
  onViewVisits,
  onDone,
}: {
  summary: string;
  guestName: string;
  windowValue: string;
  totalCents: number;
  pointsEarned: number;
  isDelivery: boolean;
  onViewVisits: () => void;
  onDone: () => void;
}) {
  const window = describePickupWindow(windowValue, new Date());
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
