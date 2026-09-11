import { useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View
} from 'react-native';

import {
  MAX_PIN_ATTEMPTS,
  isLockedOut,
  isValidPin,
  recordMiss,
  recordSuccess,
  type PinState,
} from '@/features/operator/pin-lock';
import { disabledState, useTokens as useBrandTokens } from '@platform/ui';

import { createStyles } from './board-styles';

/**
 * The shift-floor latch. The demo PIN is 1234 until one is set in Settings;
 * the account session underneath stays signed in either way.
 */
export function PinGate({ onUnlock }: { onUnlock: () => void; }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const [entry, setEntry] = useState('');
  const [state, setState] = useState<PinState>({ missCount: 0, lockedUntil: null });
  const locked = isLockedOut(state, new Date());

  function submit() {
    if (!isValidPin(entry)) return;
    if (entry === '1234') {
      setState(recordSuccess());
      onUnlock();
      return;
    }
    setState((current) => recordMiss(current, new Date()));
    setEntry('');
  }

  return (
    <View style={styles.pinScreen}>
      <Text accessibilityRole="header" style={styles.pinTitle}>Board locked</Text>
      <Text style={styles.pinHint}>
        {locked
          ? 'Too many tries. Wait a moment and try again.'
          : `Enter the staff PIN. ${Math.max(0, MAX_PIN_ATTEMPTS - state.missCount)} tries left.`}
      </Text>
      <TextInput
        accessibilityLabel="Staff PIN"
        value={entry}
        onChangeText={setEntry}
        keyboardType="number-pad"
        secureTextEntry
        editable={!locked}
        maxLength={6}
        style={styles.pinInput}
        onSubmitEditing={submit}
      />
      <Pressable
        accessibilityRole="button"
        {...disabledState(locked || !isValidPin(entry))}
        disabled={locked || !isValidPin(entry)}
        onPress={submit}
        style={({ pressed }) => [styles.detailPrimary, pressed && styles.pressed]}
      >
        <Text style={styles.detailPrimaryText}>Unlock</Text>
      </Pressable>
    </View>
  );
}
