import { useStripe } from '@/lib/stripe';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { Body, Button, Card, Eyebrow, Screen, SectionTitle, Title } from '@/components/ui';
import { NativeOptionPicker } from '@/components/native-option-picker';
import { DEMO_ADD_ONS, SERVICES } from '@/data/catalog';
import {
  fulfillmentDetail,
  fulfillmentLabel,
  type BookingFulfillment,
} from '@/features/booking/fulfillment';
import { groupBookingServices, projectServices, type BookingServiceGroup } from '@/features/booking/service-projections';
import { mobileApi } from '@/lib/mobile-api';
import { addAppointmentToCalendar, usesSimulatedNativeFlows } from '@/lib/native-adapters';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { useDemo } from '@/state/demo-context';
import { demoSlotFor } from '@/state/demo-state';
import { colors, fonts, radius, spacing } from '@/theme/tokens';
import type { BookingAddOn, BookingService } from '@/types/domain';
import { choiceState } from '@/lib/a11y-state';
import { SELECTABLE_DAYS, upcomingDates } from '@/features/dates';
import matcha from '../../../assets/menu/rooh-afza-matcha.webp';
import latte from '../../../assets/menu/spanish-latte.webp';
import sweets from '../../../assets/menu/mochi-donut.webp';
import refresher from '../../../assets/menu/midnight-lychee.webp';
import pastry from '../../../assets/menu/nutella-croissant.webp';

type SessionGroup = BookingServiceGroup;

function imageForSession(slug: string) {
  if (slug.startsWith('rooh-afza') || slug.startsWith('adeni')) return matcha;
  if (slug.startsWith('midnight') || slug.startsWith('sunset') || slug.startsWith('boba')) return refresher;
  if (slug.startsWith('mochi') || slug.startsWith('milk-cake')) return sweets;
  if (slug.startsWith('nutella') || slug.startsWith('honeycomb')) return pastry;
  return latte;
}

/**
 * Sizes live in the duration slot (12/16/20 = ounces). Food slugs carry
 * -single/-double/-trio/-slice or nothing, which read as Single/Double/etc.
 */
function sizeLabelFor(slug: string): string {
  const oz = /-(\d+)$/.exec(slug);
  if (oz) return `${oz[1]} oz`;
  if (slug.endsWith('-single')) return 'Single';
  if (slug.endsWith('-double')) return 'Double';
  if (slug.endsWith('-trio')) return 'Trio';
  if (slug.endsWith('-slice')) return 'Slice';
  return 'Each';
}

function demoGroups(): SessionGroup[] {
  const services = projectServices(SERVICES).map((service) => ({ ...service, category: 'therapeutic' as const }));
  return groupBookingServices(services, imageForSession);
}

function groupSessions(services: BookingService[]): SessionGroup[] {
  return groupBookingServices(services, imageForSession);
}

export function BookScreen({
  fulfillment,
  onChangeFulfillment,
}: {
  fulfillment?: BookingFulfillment;
  onChangeFulfillment?: () => void;
}) {
  const { isDemo, refresh } = useAuth();
  const { selectedServiceId } = useAppState();
  const demo = useDemo();
  const stripe = useStripe();
  const [groups, setGroups] = useState<SessionGroup[]>(demoGroups());
  const [addOns, setAddOns] = useState<BookingAddOn[]>([...DEMO_ADD_ONS]);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [groupIndex, setGroupIndex] = useState(() => Math.max(0, SERVICES.findIndex((service) => service.id === selectedServiceId)));
  const [sessionIndex, setSessionIndex] = useState(0);
  const dates = useMemo(() => upcomingDates(new Date(), SELECTABLE_DAYS), []);
  const [date, setDate] = useState(dates[0].value);
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState(() => isDemo ? (demoSlotFor(dates[0].value, '10:00 AM') ?? '') : '');
  const [loadingCatalog, setLoadingCatalog] = useState(!isDemo);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [paying, setPaying] = useState(false);
  const [depositCents, setDepositCents] = useState(2500);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const group = groups[groupIndex] ?? groups[0];
  const session = group?.sessions[sessionIndex] ?? group?.sessions[0];
  const chosenAddOns = addOns.filter((addOn) => selectedAddOns.includes(addOn.slug));
  const reviewedDepositCents = isDemo ? (session?.depositCents ?? 0) : depositCents;

  useEffect(() => {
    if (isDemo) return;
    let active = true;
    mobileApi.bookingCatalog().then((catalog) => {
      if (!active) return;
      const nextGroups = groupSessions(catalog.services);
      const requestedIndex = selectedServiceId
        ? nextGroups.findIndex((item) => item.sessions.some((itemSession) => itemSession.slug.startsWith(selectedServiceId)))
        : 0;
      setGroups(nextGroups);
      setAddOns(catalog.addOns);
      setGroupIndex(Math.max(0, requestedIndex));
      setSessionIndex(0);
    }).catch((catalogError) => {
      if (!active) return;
      setError(catalogError instanceof Error ? catalogError.message : 'Services could not be loaded.');
    }).finally(() => {
      if (active) setLoadingCatalog(false);
    });
    return () => {
      active = false;
    };
  }, [isDemo, selectedServiceId]);

  useEffect(() => {
    if (!session || isDemo) return;
    let active = true;
    void (async () => {
      setLoadingSlots(true);
      setError(null);
      try {
        const availability = await mobileApi.availability(session.slug, date, selectedAddOns);
        if (!active) return;
        setSlots(availability.slots);
        setSlot(availability.slots[0] ?? '');
        setDepositCents(availability.depositCents);
      } catch (availabilityError) {
        if (!active) return;
        setSlots([]);
        setError(availabilityError instanceof Error ? availabilityError.message : 'Openings could not be loaded.');
      } finally {
        if (active) setLoadingSlots(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [date, isDemo, selectedAddOns, session]);

  async function reserve() {
    if (!session) return;
    if (!slot) {
      setError('Choose an available time.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if (isDemo) {
      demo.book({ service: session, addOns: chosenAddOns, startsAt: slot, fulfillment });
      setConfirmed(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    if (usesSimulatedNativeFlows(isDemo, Constants.appOwnership)) {
      setError('Expo Go uses simulated payments in Demo mode. Switch to Demo from More to preview this order.');
      return;
    }
    setPaying(true);
    setError(null);
    try {
      // The add-ons MUST be part of the key: they change the price. Keyed only on
      // service/mode/slot, abandoning a payment and re-booking the same slot with
      // a different add-on selection resumed the original PaymentIntent, so the
      // client was charged the earlier amount for the newer booking. Sorted so an
      // identical selection in a different tap order still dedupes.
      // Separator MUST come from normalizeIdempotencyKey's allowed charset
      // (lib/portal/idempotency.ts: [A-Za-z0-9._:/-]). '+' is not in it, so a
      // key joining two or more add-ons failed validation and the booking route
      // returned 400 before pricing anything -- a live client who picked two
      // enhancements could not book at all. A single add-on produced no
      // separator, which is why this shipped looking fine.
      const addOnFingerprint = [...selectedAddOns].sort().join('.') || 'none';
      const idempotencyKey =
        `booking-${session.slug}-${fulfillment?.mode ?? 'office'}-${slot}-${addOnFingerprint}`;
      const payment = await mobileApi.createBookingPayment({
        serviceSlug: session.slug,
        addonSlugs: selectedAddOns,
        slot,
        fulfillment,
        idempotencyKey,
      });
      if (!payment.paymentRequired) {
        await refresh();
        setConfirmed(true);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }
      const initialized = await stripe.initPaymentSheet({
        merchantDisplayName: 'Coffee Story',
        paymentIntentClientSecret: payment.paymentIntent,
        customerEphemeralKeySecret: payment.ephemeralKey,
        customerId: payment.customer,
        returnURL: 'coffeestory://stripe-redirect',
      });
      if (initialized.error) throw new Error(initialized.error.message);
      const presented = await stripe.presentPaymentSheet();
      if (presented.error) throw new Error(presented.error.message);
      await refresh();
      setConfirmed(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (reserveError) {
      setError(reserveError instanceof Error ? reserveError.message : 'Your visit could not be reserved.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setPaying(false);
    }
  }

  if (confirmed && session) {
    return (
      <Confirmation
        session={session}
        slot={slot}
        isDemo={isDemo}
        fulfillment={fulfillment}
        onReset={() => setConfirmed(false)}
      />
    );
  }

  return (
    <CollapsingScreen title="What are you craving today?" eyebrow="Start an order">
      <Body muted>
        {depositCents > 0
          ? `Your $${(depositCents / 100).toFixed(0)} prepayment is securely applied to the order.`
          : 'Pay at pickup — nothing due today.'}
      </Body>
      {fulfillment ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Change pickup or delivery"
          disabled={!onChangeFulfillment}
          onPress={() => {
            void Haptics.selectionAsync();
            onChangeFulfillment?.();
          }}
          style={({ pressed }) => [styles.locationSummary, pressed && styles.pressed]}
        >
          <View style={styles.locationMark}>
            <Text style={styles.locationMarkText}>{fulfillment.mode === 'office' ? 'O' : 'D'}</Text>
          </View>
          <View style={styles.locationCopy}>
            <Text style={styles.locationTitle}>{fulfillmentLabel(fulfillment)}</Text>
            <Text style={styles.locationDetail}>{fulfillmentDetail(fulfillment)}</Text>
          </View>
          {onChangeFulfillment ? <Text style={styles.locationChange}>Change</Text> : null}
        </Pressable>
      ) : null}
      {isDemo ? <Card style={styles.demo}><Body>Preview mode uses sample openings and does not charge a card.</Body></Card> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <SectionTitle>1. Menu</SectionTitle>
      {loadingCatalog ? <Card><Body muted>Loading the current service menu…</Body></Card> : groups.map((item, index) => (
        <Pressable
          key={item.name}
          accessibilityRole="radio"
          {...choiceState(index === groupIndex)}
          onPress={() => {
            setGroupIndex(index);
            setSessionIndex(0);
            void Haptics.selectionAsync();
          }}
          style={({ pressed }) => [styles.service, index === groupIndex && styles.serviceActive, pressed && styles.pressed]}
        >
          <Image source={item.image} style={styles.serviceImage} contentFit="cover" alt={`${item.name} treatment`} />
          <View style={styles.serviceCopy}>
            <Text style={styles.serviceTitle}>{item.name}</Text>
            <Text numberOfLines={2} style={styles.serviceDescription}>{item.description}</Text>
          </View>
          <View style={[styles.radio, index === groupIndex && styles.radioActive]} />
        </Pressable>
      ))}

      {group ? (
        <>
          <SectionTitle>2. Length</SectionTitle>
          <View style={styles.choiceRow}>
            {group.sessions.map((item, index) => (
              <Choice
                key={item.slug}
                selected={index === sessionIndex}
                label={sizeLabelFor(item.slug)}
                meta={`$${item.priceCents / 100}`}
                onPress={() => setSessionIndex(index)}
              />
            ))}
          </View>
        </>
      ) : null}

      <SectionTitle>3. Date</SectionTitle>
      <NativeOptionPicker
        label="Pickup date"
        value={date}
        options={dates}
        onChange={(value) => {
          setDate(value);
          if (isDemo) setSlot(demoSlotFor(value, '10:00 AM') ?? '');
        }}
      />

      <SectionTitle>4. Time</SectionTitle>
      {isDemo ? (
        <NativeOptionPicker
          label="Pickup time"
          value={slot}
          options={['10:00 AM', '11:30 AM', '1:00 PM', '2:30 PM'].map((item) => ({ value: demoSlotFor(date, item) ?? '', label: item }))}
          onChange={setSlot}
        />
      ) : loadingSlots ? <Card><Body muted>Checking live openings…</Body></Card> : slots.length ? (
        <NativeOptionPicker
          label="Pickup time"
          value={slot}
          options={slots.map((item) => ({ value: item, label: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(item)) }))}
          onChange={setSlot}
        />
      ) : <Card><Body muted>No openings remain on this day. Choose another date.</Body></Card>}

      <SectionTitle>5. Enhancements</SectionTitle>
      <View style={styles.addOnList}>
        {addOns.map((addOn) => {
          const selected = selectedAddOns.includes(addOn.slug);
          return (
            <Pressable
              key={addOn.slug}
              accessibilityRole="checkbox"
              {...choiceState(selected)}
              onPress={() => setSelectedAddOns((current) => (
                selected ? current.filter((slug) => slug !== addOn.slug) : [...current, addOn.slug]
              ))}
              onPressIn={() => void Haptics.selectionAsync()}
              style={({ pressed }) => [styles.addOn, selected && styles.addOnActive, pressed && styles.pressed]}
            >
              <View style={styles.addOnCopy}>
                <Text style={styles.serviceTitle}>{addOn.name}</Text>
                <Text style={styles.serviceDescription}>{addOn.description}</Text>
              </View>
              <Text style={styles.addOnPrice}>+${(addOn.priceCents / 100).toFixed(0)}</Text>
            </Pressable>
          );
        })}
      </View>

      {session ? (
        <Card style={styles.summary}>
          <Text style={styles.summaryTitle}>{session.name}</Text>
          <Body muted>
            {sizeLabelFor(session.slug)} · ${((session.priceCents + chosenAddOns.reduce((total, addOn) => total + addOn.priceCents, 0)) / 100).toFixed(2)} total
          </Body>
          <View style={styles.totalRow}><Text style={styles.totalLabel}>{reviewedDepositCents > 0 ? 'Due today' : 'Due at pickup'}</Text><Text style={styles.total}>${(reviewedDepositCents / 100).toFixed(0)}</Text></View>
          <Button
            label={reviewedDepositCents > 0 ? `Pay $${(reviewedDepositCents / 100).toFixed(0)} now` : 'Place pickup order'}
            accessibilityLabel="Place order"
            loading={paying}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              void reserve();
            }}
          />
        </Card>
      ) : null}
    </CollapsingScreen>
  );
}

function Choice({ selected, label, meta, onPress }: { selected: boolean; label: string; meta?: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      {...choiceState(selected)}
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [styles.choice, selected && styles.choiceActive, pressed && styles.pressed]}
    >
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelActive]}>{label}</Text>
      {meta ? <Text style={[styles.choiceMeta, selected && styles.choiceLabelActive]}>{meta}</Text> : null}
    </Pressable>
  );
}

function Confirmation({
  session,
  slot,
  isDemo,
  fulfillment,
  onReset,
}: {
  session: BookingService;
  slot: string;
  isDemo: boolean;
  fulfillment?: BookingFulfillment;
  onReset: () => void;
}) {
  const date = new Date(slot);
  const when = Number.isNaN(date.getTime()) ? slot : new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short' }).format(date);

  async function addToCalendar() {
    try {
      const result = await addAppointmentToCalendar(session, slot, isDemo, Constants.appOwnership);
      Alert.alert(result.simulated ? 'Calendar preview' : 'Added to calendar', result.message);
    } catch (calendarError) {
      Alert.alert('Calendar unavailable', calendarError instanceof Error ? calendarError.message : 'Try again from a development build.');
    }
  }

  return (
    <Screen contentContainerStyle={styles.confirmation}>
      <View style={styles.check}><Text style={styles.checkText}>FH</Text></View>
      <Eyebrow>Visit reserved</Eyebrow>
      <Title>Your time is yours.</Title>
      <Body muted>{session.name} will be ready around {when}. Your receipt and confirmation are in your account.</Body>
      {fulfillment ? (
        <Card style={styles.confirmedLocation}>
          <Text style={styles.locationTitle}>{fulfillmentLabel(fulfillment)}</Text>
          <Body muted>{fulfillmentDetail(fulfillment)}</Body>
        </Card>
      ) : null}
      <Button label="Add to calendar" onPress={() => void addToCalendar()} />
      <Button label="Start another order" variant="secondary" onPress={onReset} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  demo: { backgroundColor: colors.gold50 },
  error: { color: colors.danger, fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 19 },
  locationSummary: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brand200, backgroundColor: colors.brand50, padding: spacing.md },
  locationMark: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand200 },
  locationMarkText: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 15 },
  locationCopy: { flex: 1, gap: spacing.xs },
  locationTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  locationDetail: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  locationChange: { color: colors.brand700, fontFamily: fonts.sansBold, fontSize: 12 },
  service: { minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brand100, backgroundColor: colors.white, padding: spacing.sm },
  serviceActive: { borderColor: colors.brand600, backgroundColor: colors.brand50 },
  serviceImage: { width: 84, height: 84, borderRadius: radius.md },
  serviceCopy: { flex: 1, gap: 4 },
  serviceTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  serviceDescription: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.ink300, marginRight: 4 },
  radioActive: { borderWidth: 6, borderColor: colors.brand600 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { minWidth: 94, minHeight: 64, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  choiceActive: { backgroundColor: colors.brand600, borderColor: colors.brand600 },
  choiceLabel: { color: colors.ink700, fontFamily: fonts.sansBold, fontSize: 13 },
  choiceLabelActive: { color: colors.white },
  choiceMeta: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 11, marginTop: 2 },
  addOnList: { gap: spacing.sm },
  addOn: { minHeight: 78, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, backgroundColor: colors.white, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  addOnActive: { borderColor: colors.brand600, backgroundColor: colors.brand50 },
  addOnCopy: { flex: 1, gap: 4 },
  addOnPrice: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 14 },
  summary: { gap: spacing.md, marginTop: spacing.lg, backgroundColor: colors.warm },
  summaryTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 18 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.ink200, paddingTop: spacing.md },
  totalLabel: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 14 },
  total: { color: colors.ink900, fontFamily: fonts.display, fontSize: 28 },
  confirmation: { alignItems: 'stretch', justifyContent: 'center', minHeight: '100%', paddingBottom: 140 },
  check: { width: 108, height: 108, alignSelf: 'center', borderRadius: 54, backgroundColor: colors.brand200, alignItems: 'center', justifyContent: 'center' },
  checkText: { color: colors.brand700, fontFamily: fonts.display, fontSize: 34 },
  confirmedLocation: { gap: spacing.xs, backgroundColor: colors.brand50 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
