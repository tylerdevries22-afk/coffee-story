/**
 * The two steps between choosing pickup-or-delivery and reaching the menu:
 * where the order is going, and when it is wanted.
 *
 * Both are pushed pages that cover the tab bar, so they use the sticky action
 * bar's covering inset rather than the tab-bar clearance.
 */
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { AppIcon } from '@/components/icon';
import { ActionButton, StickyActionBar, useStickyBarClearance } from '@/components/order/order-chrome';
import { Body } from '@/components/ui';
import {
  EMPTY_DELIVERY_ADDRESS,
  PICKUP_LOCATIONS,
  deliveryAddressLine,
  validateDeliveryAddress,
  type OrderFulfillment,
  type DeliveryAddress,
  type PickupLocation,
  type FulfillmentMode,
} from '@platform/domain';
import { formatMoney , DELIVERY_FEE_CENTS } from '@platform/domain';
import { pickupWindows, shopStatus, type PickupWindow } from '@/features/order/pickup';
import { choiceState } from '@platform/ui';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/** Enough windows to fill a scroll without pretending the shop is limitless. */
const WINDOW_COUNT = 12;
/** A search field only earns its place once the list is long enough to hunt in. */
const SEARCH_THRESHOLD = 4;

const DEMO_ADDRESS: DeliveryAddress = {
  street: '1240 Dayton Street',
  unit: '',
  city: 'Aurora',
  state: 'CO',
  postalCode: '80010',
  instructions: '',
};

/* ------------------------------------------------------------------ place */

export function PlaceStep({
  mode,
  isDemo,
  initialAddress,
  onBack,
  onChoose,
}: {
  mode: FulfillmentMode;
  isDemo: boolean;
  initialAddress?: DeliveryAddress;
  onBack: () => void;
  onChoose: (fulfillment: OrderFulfillment) => void;
}) {
  return mode === 'pickup'
    ? <PickupLocationStep onBack={onBack} onChoose={onChoose} />
    : <DeliveryAddressStep isDemo={isDemo} initialAddress={initialAddress} onBack={onBack} onChoose={onChoose} />;
}

function PickupLocationStep({
  onBack,
  onChoose,
}: {
  onBack: () => void;
  onChoose: (fulfillment: OrderFulfillment) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const [query, setQuery] = useState('');
  const searchable = PICKUP_LOCATIONS.length >= SEARCH_THRESHOLD;
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return PICKUP_LOCATIONS;
    return PICKUP_LOCATIONS.filter((office) => (
      `${office.name} ${office.address} ${office.cityLine}`.toLowerCase().includes(needle)
    ));
  }, [query]);

  return (
    <CollapsingScreen
      title="Select Pickup Location"
      onBack={onBack}
      backLabel="Order"
      keyboardShouldPersistTaps="handled"
      style={styles.page}
      headerBackgroundColor={tokens.surface}
      headerBorderColor={tokens.surface}
      contentContainerStyle={styles.content}
    >
      {searchable ? (
        <View style={styles.searchField}>
          <AppIcon name="magnifyingglass" size={18} tintColor={tokens.textMuted} />
          <TextInput
            accessibilityLabel="Search locations by city, state, or ZIP code"
            value={query}
            onChangeText={setQuery}
            placeholder="Search city, state, or ZIP"
            placeholderTextColor={tokens.textMuted}
            style={styles.searchInput}
          />
        </View>
      ) : null}

      {matches.length === 0 ? (
        <Body muted>No Coffee Story shop matches “{query.trim()}”.</Body>
      ) : (
        matches.map((location) => (
          <LocationCard
            key={location.id}
            location={location}
            onPress={() => {
              void Haptics.selectionAsync().catch(() => undefined);
              onChoose({ mode: 'pickup', location });
            }}
          />
        ))
      )}
    </CollapsingScreen>
  );
}

function LocationCard({ location, onPress }: { location: PickupLocation; onPress: () => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const status = shopStatus(new Date());
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${location.name}, ${location.address}, ${location.cityLine}. ${status.label}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.locationCard, pressed && styles.pressed]}
    >
      <View style={styles.locationMark}>
        <AppIcon name="cup.and.saucer.fill" size={20} tintColor={tokens.primary} />
      </View>
      <View style={styles.locationCopy}>
        <Text style={styles.locationName}>{location.name}</Text>
        <View style={styles.locationBadges}>
          <View style={[styles.statusBadge, status.open ? styles.statusBadgeOpen : styles.statusBadgeShut]}>
            <Text style={[styles.statusText, status.open ? styles.statusTextOpen : styles.statusTextShut]}>
              {status.label}
            </Text>
          </View>
          <Text style={styles.locationNote}>{location.note}</Text>
        </View>
        <Text style={styles.locationAddress}>{location.address}, {location.cityLine}</Text>
      </View>
      <AppIcon name="chevron.right" size={18} tintColor={tokens.textMuted} />
    </Pressable>
  );
}

function DeliveryAddressStep({
  isDemo,
  initialAddress,
  onBack,
  onChoose,
}: {
  isDemo: boolean;
  initialAddress?: DeliveryAddress;
  onBack: () => void;
  onChoose: (fulfillment: OrderFulfillment) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const [address, setAddress] = useState<DeliveryAddress>(initialAddress ?? EMPTY_DELIVERY_ADDRESS);
  const [error, setError] = useState<string | null>(null);
  const clearance = useStickyBarClearance();
  const update = (field: keyof DeliveryAddress, value: string) => {
    setAddress((current) => ({ ...current, [field]: value }));
    setError(null);
  };
  const summary = validateDeliveryAddress(address) ? null : deliveryAddressLine(address);

  function confirm() {
    const addressError = validateDeliveryAddress(address);
    if (addressError) {
      setError(addressError);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }
    onChoose({ mode: 'delivery', address: { ...address, state: address.state.toUpperCase() } });
  }

  return (
    <>
      <CollapsingScreen
        title="Delivery Address"
        onBack={onBack}
        backLabel="Order"
        keyboardShouldPersistTaps="handled"
        style={styles.page}
        headerBackgroundColor={tokens.surface}
        headerBorderColor={tokens.surface}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      >
        <Body muted>
          We deliver within Aurora and the surrounding metro. A {formatMoney(DELIVERY_FEE_CENTS)} delivery
          fee is added at checkout.
        </Body>
        {isDemo ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Use the demo home address, ${deliveryAddressLine(DEMO_ADDRESS)}`}
            onPress={() => {
              setAddress(DEMO_ADDRESS);
              setError(null);
              void Haptics.selectionAsync().catch(() => undefined);
            }}
            style={({ pressed }) => [styles.savedAddress, pressed && styles.pressed]}
          >
            <AppIcon name="house.fill" size={22} tintColor={tokens.primary} />
            <View style={styles.locationCopy}>
              <Text style={styles.locationName}>Use demo home address</Text>
              <Text style={styles.locationAddress}>{deliveryAddressLine(DEMO_ADDRESS)}</Text>
            </View>
            <AppIcon name="arrow.down.to.line" size={18} tintColor={tokens.textMuted} />
          </Pressable>
        ) : null}
        <Field label="Street address" value={address.street} onChangeText={(value) => update('street', value)} maxLength={200} autoComplete="street-address" />
        <Field label="Apartment, suite, or floor" value={address.unit} onChangeText={(value) => update('unit', value)} maxLength={100} />
        <View style={styles.fieldRow}>
          <Field containerStyle={styles.cityField} label="City" value={address.city} onChangeText={(value) => update('city', value)} maxLength={100} />
          <Field containerStyle={styles.stateField} label="State" value={address.state} onChangeText={(value) => update('state', value.slice(0, 2).toUpperCase())} maxLength={2} autoCapitalize="characters" />
        </View>
        <Field label="ZIP code" value={address.postalCode} onChangeText={(value) => update('postalCode', value)} maxLength={10} keyboardType="numbers-and-punctuation" autoComplete="postal-code" />
        <Field label="Drop-off notes" value={address.instructions} onChangeText={(value) => update('instructions', value)} maxLength={500} placeholder="Gate code, parking, or where to leave it" multiline />
        {summary ? (
          <View style={styles.addressPreview}>
            <AppIcon name="checkmark.circle.fill" size={20} tintColor={tokens.success} />
            <Text style={styles.addressPreviewText}>{summary}</Text>
          </View>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </CollapsingScreen>
      <StickyActionBar>
        <ActionButton label="Continue" onPress={confirm} />
      </StickyActionBar>
    </>
  );
}

/* ---------------------------------------------------------------- details */

export function DetailsStep({
  mode,
  guestName,
  windowValue,
  now,
  onBack,
  onChangeName,
  onChangeWindow,
  onDone,
}: {
  mode: FulfillmentMode;
  guestName: string;
  windowValue: string | null;
  now: Date;
  onBack: () => void;
  onChangeName: (name: string) => void;
  onChangeWindow: (value: string) => void;
  onDone: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const clearance = useStickyBarClearance();
  const windows = useMemo(() => pickupWindows(now, WINDOW_COUNT), [now]);
  const [error, setError] = useState<string | null>(null);
  const heading = mode === 'pickup' ? 'Pickup Options' : 'Delivery Options';

  function confirm() {
    if (!guestName.trim()) {
      setError('Add the name the order should be called out under.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }
    if (!windowValue) {
      setError(mode === 'pickup' ? 'Choose a pickup time.' : 'Choose a delivery time.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }
    onDone();
  }

  return (
    <>
      <CollapsingScreen
        title={heading}
        onBack={onBack}
        backLabel="Back"
        keyboardShouldPersistTaps="handled"
        style={styles.page}
        headerBackgroundColor={tokens.surface}
        headerBorderColor={tokens.surface}
        contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
      >
        <Field
          label="Name for the order"
          value={guestName}
          onChangeText={(value) => {
            onChangeName(value);
            setError(null);
          }}
          maxLength={60}
          autoComplete="name"
          placeholder="Who should we call?"
          onClear={guestName ? () => onChangeName('') : undefined}
        />

        <Text style={styles.sectionLabel}>
          {mode === 'pickup' ? 'Pickup time' : 'Delivery time'}
        </Text>
        {windows.length === 0 ? (
          <Body muted>The shop is closed for the next couple of days. Try again soon.</Body>
        ) : (
          <View accessibilityRole="radiogroup" style={styles.windowGrid}>
            {windows.map((window) => (
              <WindowChip
                key={window.value}
                window={window}
                selected={window.value === windowValue}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  onChangeWindow(window.value);
                  setError(null);
                }}
              />
            ))}
          </View>
        )}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </CollapsingScreen>
      <StickyActionBar>
        <ActionButton label="See the menu" onPress={confirm} />
      </StickyActionBar>
    </>
  );
}

function WindowChip({
  window,
  selected,
  onPress,
}: {
  window: PickupWindow;
  selected: boolean;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${window.dayLabel}, ${window.timeLabel}`}
      {...choiceState(selected)}
      onPress={onPress}
      style={({ pressed }) => [styles.windowChip, selected && styles.windowChipSelected, pressed && styles.pressed]}
    >
      <Text style={[styles.windowDay, selected && styles.windowDaySelected]}>{window.dayLabel}</Text>
      <Text style={[styles.windowTime, selected && styles.windowTimeSelected]}>{window.timeLabel}</Text>
    </Pressable>
  );
}

/* ----------------------------------------------------------------- fields */

function Field({ label, containerStyle, onClear, ...props }: TextInputProps & {
  label: string;
  containerStyle?: StyleProp<ViewStyle>;
  /** Renders the clear button. Omit when there is nothing to clear. */
  onClear?: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View>
        <TextInput
          {...props}
          accessibilityLabel={label}
          placeholderTextColor={tokens.textMuted}
          style={[styles.input, props.multiline && styles.multiline, onClear && styles.inputClearable]}
        />
        {onClear ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
            hitSlop={8}
            onPress={onClear}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
          >
            <AppIcon name="xmark.circle.fill" size={20} tintColor={tokens.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  page: { backgroundColor: tokens.surface },
  content: { gap: tokens.spacing.lg },
  pressed: { opacity: 0.72 },

  searchField: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
    paddingHorizontal: tokens.spacing.lg,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surfaceElevated,
  },
  searchInput: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },

  locationCard: {
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.lg,
    padding: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surfaceElevated,
    shadowColor: tokens.textPrimary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: tokens.elevation.card, shadowRadius: 24, elevation: 5,
  },
  locationMark: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.surface,
  },
  locationCopy: { flex: 1, gap: 4 },
  locationName: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  locationBadges: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, flexWrap: 'wrap' },
  statusBadge: { paddingHorizontal: tokens.spacing.md, paddingVertical: 2, borderRadius: tokens.radius.pill },
  statusBadgeOpen: { backgroundColor: tokens.surface },
  statusBadgeShut: { backgroundColor: tokens.surface },
  statusText: { fontFamily: tokens.fontBody, fontSize: 11 },
  statusTextOpen: { color: tokens.warning },
  statusTextShut: { color: tokens.textMuted },
  locationNote: { flex: 1, color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 11 },
  locationAddress: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 18 },

  savedAddress: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.lg,
    padding: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.surface,
    backgroundColor: tokens.surface,
  },

  sectionLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 18, marginTop: tokens.spacing.md },
  windowGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.spacing.md },
  windowChip: {
    minWidth: '47%',
    flexGrow: 1,
    minHeight: 62,
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.surface,
    backgroundColor: tokens.surfaceElevated,
    gap: 2,
  },
  windowChipSelected: { borderColor: tokens.primary, backgroundColor: tokens.surface },
  windowDay: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
  windowDaySelected: { color: tokens.primary },
  windowTime: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },
  windowTimeSelected: { color: tokens.textPrimary },

  field: { gap: tokens.spacing.sm },
  fieldRow: { flexDirection: 'row', gap: tokens.spacing.md },
  cityField: { flex: 1 },
  stateField: { width: 84 },
  fieldLabel: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 13 },
  input: {
    minHeight: 52,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.secondary,
    backgroundColor: tokens.surfaceElevated,
    color: tokens.textPrimary,
    fontFamily: tokens.fontBody,
    fontSize: 16,
    paddingHorizontal: tokens.spacing.lg,
  },
  multiline: { minHeight: 88, paddingTop: tokens.spacing.lg, textAlignVertical: 'top' },
  inputClearable: { paddingRight: 48 },
  clearButton: {
    position: 'absolute',
    right: tokens.spacing.md,
    top: 0,
    bottom: 0,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: tokens.spacing.md,
    padding: tokens.spacing.lg,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
  },
  addressPreviewText: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 12, lineHeight: 18 },
  error: { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 19 },
});
