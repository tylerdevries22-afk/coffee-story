import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { StepHeading } from '@/components/chrome/step-heading';
import { formatPhone, isCompletePhone, maskPhone } from '@/features/identity';
import * as haptics from '@/lib/haptics';
import { useFlow } from '@/state/flow';
import { useGuest } from '@/state/guest';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const;

/**
 * A numeric keypad, on screen rather than the OS keyboard.
 *
 * A kiosk is bolted down and `requireFullScreen` is set, so the system keyboard
 * would cover half a landscape screen and offer a guest a way out of the app.
 * Ten large keys are also simply easier at arm's length than a phone keyboard.
 */
export default function KeypadStep() {
  const tokens = useTokens();
  const { goNext, goTo } = useFlow();
  const { setMaskedPhone } = useGuest();
  const [digits, setDigits] = useState('');

  const complete = isCompletePhone(digits);

  function press(key: string) {
    haptics.tapped();
    if (key === '⌫') setDigits((current) => current.slice(0, -1));
    else if (key) setDigits((current) => (current.length >= 10 ? current : current + key));
  }

  function submit() {
    // Only the mask survives. The raw number is used to look up and then
    // dropped -- the next guest in the queue sees this screen.
    setMaskedPhone(maskPhone(digits));
    goNext({ identified: true });
  }

  return (
    <View style={styles.root}>
      <StepHeading title="What's your phone number?" />

      <Text
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Entered ${digits.length} of 10 digits`}
        style={[styles.display, { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.hero }]}
      >
        {formatPhone(digits) || '(   )   -    '}
      </Text>

      <View style={styles.pad}>
        {KEYS.map((key, index) => (
          key === '' ? <View key={`gap-${index}`} style={styles.key} /> : (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={key === '⌫' ? 'Delete' : key}
              onPress={() => press(key)}
              style={({ pressed }) => [
                styles.key,
                {
                  borderRadius: tokens.radius.lg,
                  backgroundColor: tokens.surfaceElevated,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text style={{ color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.display }}>
                {key}
              </Text>
            </Pressable>
          )
        ))}
      </View>

      <View style={styles.actions}>
        <KioskPressable label="Look me up" disabled={!complete} onPress={submit} />
        <KioskPressable label="Skip" variant="secondary" onPress={() => goTo('processing')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingHorizontal: 32, gap: 12 },
  display: { letterSpacing: 2, minHeight: 72 },
  pad: { width: 420, flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  // 132pt keys: this is the one screen where a mis-tap means a stranger account.
  key: { width: 132, height: 96, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 20, paddingTop: 10 },
});
