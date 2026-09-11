/** Pickup or delivery scheduling after the guest chooses a place. */
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CollapsingScreen } from '@/components/collapsing-screen';
import { ActionButton, StickyActionBar, useStickyBarClearance } from '@/components/order/order-chrome';
import { Body } from '@/components/ui';
import { pickupWindows } from '@/features/order/schedule';
import type { FulfillmentMode, PickupWindow } from '@platform/domain';
import { choiceState, useTokens as useBrandTokens } from '@platform/ui';

import { Field } from './fulfillment-field';
import { createStyles } from './fulfillment-step-styles';

const WINDOW_COUNT = 12;

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

export { PlaceStep } from './fulfillment-place-step';
