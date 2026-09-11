import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { ActionButton, StickyActionBar, useStickyBarClearance } from '@/components/order/order-chrome';
import { Body } from '@/components/ui';
import { EMPTY_DELIVERY_ADDRESS } from '@/features/order/locations';
import { TENANT } from '@/tenant';
import {
  DELIVERY_FEE_CENTS,
  deliveryAddressLine,
  formatMoney,
  validateDeliveryAddress,
  type DeliveryAddress,
  type OrderFulfillment,
} from '@platform/domain';
import { AppIcon, useTokens as useBrandTokens } from '@platform/ui';

import { Field } from './fulfillment-field';
import { createStyles } from './fulfillment-step-styles';

const DEMO_ADDRESS: DeliveryAddress = {
  street: TENANT.location.address.street,
  unit: '',
  city: TENANT.location.address.city,
  state: TENANT.location.address.region,
  postalCode: TENANT.location.address.postal,
  instructions: '',
};

export function DeliveryAddressStep({
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
          We deliver within {TENANT.location.address.city || 'the local area'} and the surrounding metro. A {formatMoney(DELIVERY_FEE_CENTS)} delivery
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
