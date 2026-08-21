import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { PushFromRight } from '@/components/push-from-right';
import { CollapsingScreen } from '@/components/collapsing-screen';
import { SiriAssistant, type SiriCommand } from '@/components/siri/siri-assistant';
import { Body, Button, SectionTitle } from '@/components/ui';
import {
  dispatchAddressLine,
  EMPTY_DISPATCH_ADDRESS,
  OFFICE_LOCATIONS,
  validateDispatchAddress,
  type BookingFulfillment,
  type DispatchAddress,
  type VisitMode,
} from '@/features/booking/fulfillment';
import { useAppState } from '@/state/app-context';
import { useAuth } from '@/state/auth-context';
import { colors, fonts, radius, shadow, spacing } from '@/theme/tokens';
import { BookScreen } from './book-screen';
import { AppIcon } from '@/components/icon';
import { choiceState } from '@/lib/a11y-state';

const DEMO_ADDRESS: DispatchAddress = {
  street: '1240 Maple Avenue',
  unit: '',
  city: 'Greenwood Village',
  state: 'CO',
  postalCode: '80111',
  instructions: '',
};

export function OrderScreen() {
  const { isDemo } = useAuth();
  const [mode, setMode] = useState<VisitMode | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [officeId, setOfficeId] = useState<string | null>(null);
  const [address, setAddress] = useState<DispatchAddress>(EMPTY_DISPATCH_ADDRESS);
  const [error, setError] = useState<string | null>(null);
  const [fulfillment, setFulfillment] = useState<BookingFulfillment | null>(null);

  if (fulfillment) {
    return (
      <BookScreen
        fulfillment={fulfillment}
        onChangeFulfillment={() => setFulfillment(null)}
      />
    );
  }

  function selectMode(next: VisitMode) {
    setMode(next);
    setError(null);
    setDetailOpen(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function continueToBooking() {
    const next = selectedFulfillment(mode, officeId, address);
    if (typeof next === 'string') {
      setError(next);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setError(null);
    setDetailOpen(false);
    setFulfillment(next);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  return (
    <OrderStart
      mode={mode}
      detailOpen={detailOpen}
      officeId={officeId}
      address={address}
      error={error}
      isDemo={isDemo}
      onModeChange={selectMode}
      onCloseDetail={() => {
        setDetailOpen(false);
        setError(null);
      }}
      onOfficeChange={setOfficeId}
      onAddressChange={setAddress}
      onContinue={continueToBooking}
    />
  );
}

function selectedFulfillment(
  mode: VisitMode | null,
  officeId: string | null,
  address: DispatchAddress,
): BookingFulfillment | string {
  if (!mode) return 'Choose In Studio or Mobile care.';
  if (mode === 'office') {
    const office = OFFICE_LOCATIONS.find((location) => location.id === officeId);
    return office ? { mode, office } : 'Choose the office you want to visit.';
  }
  const addressError = validateDispatchAddress(address);
  return addressError ?? { mode, address: { ...address, state: address.state.toUpperCase() } };
}

type OrderStartProps = {
  mode: VisitMode | null;
  detailOpen: boolean;
  officeId: string | null;
  address: DispatchAddress;
  error: string | null;
  isDemo: boolean;
  onModeChange: (mode: VisitMode) => void;
  onCloseDetail: () => void;
  onOfficeChange: (officeId: string) => void;
  onAddressChange: (address: DispatchAddress) => void;
  onContinue: () => void;
};

function OrderStart(props: OrderStartProps) {
  const [showAssistant, setShowAssistant] = useState(true);
  const { width } = useWindowDimensions();
  const { startBooking, openMore, setClientTab } = useAppState();
  const compact = width < 360;
  const siriCommands: readonly SiriCommand[] = [
    { key: 'book', phrase: 'Book a massage', onRun: () => startBooking() },
    { key: 'next-visit', phrase: 'When is my next visit?', onRun: () => openMore('visits') },
    { key: 'rewards', phrase: 'Check my rewards balance', onRun: () => setClientTab('rewards') },
    { key: 'gift', phrase: 'Send a gift card', onRun: () => setClientTab('gift') },
  ];
  return (
    <>
    <CollapsingScreen
      title="Start an Order"
      eyebrow="Book your care"
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
          label="Mobile"
          compact={compact}
          selected={props.mode === 'dispatch'}
          onPress={() => props.onModeChange('dispatch')}
        />
        <ModeCard
          mode="office"
          label="In Studio"
          compact={compact}
          selected={props.mode === 'office'}
          onPress={() => props.onModeChange('office')}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open digital gift cards"
        onPress={() => {
          void Haptics.selectionAsync();
          setClientTab('gift');
        }}
        style={({ pressed }) => [styles.giftCardAction, pressed && styles.cardPressed]}
      >
        <View style={styles.giftCardIcon}>
          <AppIcon name="giftcard" size={22} tintColor={colors.brand700} />
        </View>
        <View style={styles.giftCardCopy}>
          <Text style={styles.giftCardTitle}>Digital Gift Cards</Text>
          <Text style={styles.giftCardDetail}>Send a thoughtful gift in a few taps.</Text>
        </View>
        <AppIcon name="chevron.right" size={18} tintColor={colors.ink500} />
      </Pressable>
      <Body muted>Choose where your session should take place.</Body>
    </CollapsingScreen>
    {props.detailOpen && props.mode ? (
      <PushFromRight visible onDismiss={props.onCloseDetail}>
        <CollapsingScreen
          title={props.mode === 'office' ? 'In Studio' : 'Mobile'}
          eyebrow="Start an order"
          onBack={props.onCloseDetail}
          backLabel="Order"
          keyboardShouldPersistTaps="handled"
          style={styles.page}
          headerBackgroundColor={colors.brand200}
          headerBorderColor={colors.brand200}
          contentContainerStyle={[styles.content, compact && styles.contentCompact]}
        >
          {props.mode === 'office' ? (
            <OfficePicker selectedId={props.officeId} onChange={props.onOfficeChange} />
          ) : (
            <DispatchForm
              address={props.address}
              isDemo={props.isDemo}
              onChange={props.onAddressChange}
            />
          )}
          {props.error ? <Text accessibilityRole="alert" style={styles.error}>{props.error}</Text> : null}
          <Button
            label={props.mode === 'office' ? 'Continue with this office' : 'Continue with this address'}
            onPress={props.onContinue}
          />
        </CollapsingScreen>
      </PushFromRight>
    ) : null}
    </>
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
      accessibilityLabel={`${label} appointment`}
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
        : <OfficeIllustration active={selected} compact={compact} />}
      <Text style={[styles.modeLabel, compact && styles.modeLabelCompact]}>{label}</Text>
      {selected ? (
        <View style={styles.selectedBadge}>
          <AppIcon name="checkmark" size={12} tintColor={colors.white} weight="bold" />
        </View>
      ) : null}
    </Pressable>
  );
}

function DispatchIllustration({ active, compact }: { active: boolean; compact: boolean }) {
  const [progress] = useState(() => new Animated.Value(0));
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      progress.stopAnimation();
      progress.setValue(0.55);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 2400, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: 2400, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);

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

function OfficeIllustration({ active, compact }: { active: boolean; compact: boolean }) {
  const [progress] = useState(() => new Animated.Value(0));
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      progress.stopAnimation();
      progress.setValue(0);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 2000, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: 2000, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);

  const sunStyle = {
    opacity: active ? 1 : 0.8,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -7, 0] }) },
      { scale: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.06, 1] }) },
    ],
  };
  return (
    <View style={[styles.illustration, compact && styles.illustrationCompact]}>
      <Animated.View style={[styles.officeSun, compact && styles.officeSunCompact, active && styles.officeSunActive, sunStyle]}>
        <AppIcon name="heart.fill" size={24} tintColor={colors.brand700} />
      </Animated.View>
      <View style={[styles.officeBuilding, compact && styles.officeBuildingCompact, active && styles.officeBuildingActive]}>
        <View style={styles.officeRoof} />
        <View style={styles.officeWindows}>
          <View style={styles.officeWindow} />
          <View style={styles.officeDoor} />
          <View style={styles.officeWindow} />
        </View>
      </View>
    </View>
  );
}

function OfficePicker({ selectedId, onChange }: { selectedId: string | null; onChange: (id: string) => void }) {
  return (
    <>
      <SectionTitle>Choose an office</SectionTitle>
      <View accessibilityRole="radiogroup" style={styles.officeList}>
        {OFFICE_LOCATIONS.map((office) => {
          const selected = office.id === selectedId;
          return (
            <Pressable
              key={office.id}
              accessibilityRole="radio"
              {...choiceState(selected)}
              onPress={() => {
                onChange(office.id);
                void Haptics.selectionAsync();
              }}
              style={({ pressed }) => [
                styles.officeOption,
                selected && styles.officeOptionSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.officePin}>
                <AppIcon name="mappin" size={20} tintColor={colors.brand700} />
              </View>
              <View style={styles.officeCopy}>
                <Text style={styles.officeName}>{office.name}</Text>
                <Text style={styles.officeAddress}>{office.address}</Text>
                <Text style={styles.officeMeta}>{office.cityLine} · {office.note}</Text>
              </View>
              <View style={[styles.radio, selected && styles.radioSelected]} />
            </Pressable>
          );
        })}
      </View>
    </>
  );
}

function DispatchForm({ address, isDemo, onChange }: {
  address: DispatchAddress;
  isDemo: boolean;
  onChange: (address: DispatchAddress) => void;
}) {
  const summary = useMemo(
    () => validateDispatchAddress(address) ? null : dispatchAddressLine(address),
    [address],
  );
  const update = (field: keyof DispatchAddress, value: string) => onChange({ ...address, [field]: value });
  return (
    <>
      <SectionTitle>Where should we meet you?</SectionTitle>
      <Body muted>Enter a private residence, workplace, or approved event location.</Body>
      {isDemo ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            onChange(DEMO_ADDRESS);
            void Haptics.selectionAsync();
          }}
          style={({ pressed }) => [styles.savedAddress, pressed && styles.pressed]}
        >
          <AppIcon name="house.fill" size={22} tintColor={colors.brand700} />
          <View style={styles.officeCopy}>
            <Text style={styles.officeName}>Use demo home address</Text>
            <Text style={styles.officeAddress}>{dispatchAddressLine(DEMO_ADDRESS)}</Text>
          </View>
          <AppIcon name="arrow.down.to.line" size={18} tintColor={colors.ink500} />
        </Pressable>
      ) : null}
      <AddressField label="Street address" value={address.street} onChangeText={(value) => update('street', value)} maxLength={200} autoComplete="street-address" />
      <AddressField label="Apartment, suite, or floor" value={address.unit} onChangeText={(value) => update('unit', value)} maxLength={100} />
      <View style={styles.fieldRow}>
        <AddressField containerStyle={styles.cityField} label="City" value={address.city} onChangeText={(value) => update('city', value)} maxLength={100} autoComplete="address-line2" />
        <AddressField containerStyle={styles.stateField} label="State" value={address.state} onChangeText={(value) => update('state', value.slice(0, 2).toUpperCase())} maxLength={2} autoCapitalize="characters" />
      </View>
      <AddressField label="ZIP code" value={address.postalCode} onChangeText={(value) => update('postalCode', value)} maxLength={10} keyboardType="numbers-and-punctuation" autoComplete="postal-code" />
      <AddressField label="Arrival notes" value={address.instructions} onChangeText={(value) => update('instructions', value)} maxLength={500} placeholder="Gate code, parking, or access instructions" multiline />
      {summary ? (
        <View style={styles.addressPreview}>
          <AppIcon name="checkmark.circle.fill" size={20} tintColor={colors.success} />
          <Text style={styles.addressPreviewText}>{summary}</Text>
        </View>
      ) : null}
    </>
  );
}

function AddressField({ label, containerStyle, ...props }: TextInputProps & {
  label: string;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={colors.ink400}
        style={[styles.input, props.multiline && styles.multiline]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { backgroundColor: colors.brand200 },
  content: { gap: spacing.lg },
  contentCompact: { paddingHorizontal: spacing.md, gap: spacing.md },
  modeRow: { flexDirection: 'row', gap: spacing.md },
  modeRowCompact: { gap: spacing.sm },
  modeCard: { flex: 1, minHeight: 238, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.white, backgroundColor: colors.white, padding: spacing.md, alignItems: 'center', justifyContent: 'space-between', ...shadow.card },
  modeCardCompact: { minHeight: 206, borderRadius: radius.md, padding: spacing.sm },
  modeCardSelected: { borderColor: colors.brand700, backgroundColor: colors.warm },
  cardPressed: { transform: [{ scale: 0.975 }] },
  modeLabel: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 22, lineHeight: 28 },
  modeLabelCompact: { fontSize: 19, lineHeight: 24 },
  selectedBadge: { position: 'absolute', top: 12, right: 12, width: 24, height: 24, borderRadius: 12, backgroundColor: colors.brand700, alignItems: 'center', justifyContent: 'center' },
  giftCardAction: { minHeight: 72, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brand100, backgroundColor: colors.brand50, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  giftCardIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gold50, borderWidth: 1, borderColor: colors.gold300 },
  giftCardCopy: { flex: 1, gap: 3 },
  giftCardTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  giftCardDetail: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  illustration: { flex: 1, width: '100%', minHeight: 154, alignItems: 'center', justifyContent: 'center' },
  illustrationCompact: { minHeight: 132 },
  routeLine: { position: 'absolute', left: 14, right: 14, top: '58%', height: 2, backgroundColor: colors.brand200 },
  routePin: { position: 'absolute', top: '54%', width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand500 },
  routePinStart: { left: 12 },
  routePinEnd: { right: 12 },
  car: { width: 72, height: 58, alignItems: 'center', justifyContent: 'center' },
  officeSun: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.gold50, borderWidth: 1, borderColor: colors.gold300, marginBottom: -8 },
  officeSunCompact: { width: 46, height: 46, borderRadius: 23 },
  officeSunActive: { backgroundColor: colors.brand100, borderColor: colors.brand500 },
  officeBuilding: { width: 124, minHeight: 94, borderWidth: 2, borderColor: colors.ink900, backgroundColor: colors.warm, borderRadius: radius.sm, overflow: 'hidden' },
  officeBuildingCompact: { width: 102, minHeight: 84 },
  officeBuildingActive: { backgroundColor: colors.brand50 },
  officeRoof: { height: 22, backgroundColor: colors.brand300, borderBottomWidth: 2, borderBottomColor: colors.ink900 },
  officeWindows: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-evenly', padding: spacing.sm },
  officeWindow: { width: 24, height: 30, borderWidth: 1.5, borderColor: colors.ink900, backgroundColor: colors.white },
  officeDoor: { width: 28, height: 48, borderWidth: 1.5, borderColor: colors.ink900, backgroundColor: colors.brand200 },
  selectionPanel: { gap: spacing.md, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.brand100, backgroundColor: colors.surface, padding: spacing.lg, ...shadow.card },
  error: { color: colors.danger, fontFamily: fonts.sansMedium, fontSize: 13, lineHeight: 19 },
  officeList: { gap: spacing.sm },
  officeOption: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.ink200, backgroundColor: colors.white },
  officeOptionSelected: { borderColor: colors.brand600, backgroundColor: colors.brand50 },
  officePin: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand100 },
  officeCopy: { flex: 1, gap: 3 },
  officeName: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 15 },
  officeAddress: { color: colors.ink700, fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  officeMeta: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 11, lineHeight: 16 },
  radio: { width: 21, height: 21, borderRadius: 11, borderWidth: 2, borderColor: colors.ink300 },
  radioSelected: { borderWidth: 6, borderColor: colors.brand600 },
  savedAddress: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brand200, backgroundColor: colors.brand50 },
  field: { gap: spacing.xs },
  fieldRow: { flexDirection: 'row', gap: spacing.sm },
  cityField: { flex: 1 },
  stateField: { width: 84 },
  fieldLabel: { color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 13 },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.ink200, backgroundColor: colors.white, color: colors.ink900, fontFamily: fonts.sans, fontSize: 16, paddingHorizontal: spacing.md },
  multiline: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  addressPreview: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.gold50 },
  addressPreviewText: { flex: 1, color: colors.ink700, fontFamily: fonts.sansMedium, fontSize: 12, lineHeight: 18 },
  pressed: { opacity: 0.72 },
});
