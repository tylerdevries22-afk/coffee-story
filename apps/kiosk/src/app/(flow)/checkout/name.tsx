import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { parseGuestLabel, MAX_GUEST_LABEL } from '@platform/domain';
import { useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { StepHeading } from '@/components/chrome/step-heading';
import { useFlow } from '@/state/flow';
import { useGuest } from '@/state/guest';

/**
 * The name the shop calls out.
 *
 * Validated as it is typed with the same function the SERVER enforces, so a
 * guest is never told at the end that a name they already entered is not
 * allowed. The rule is strict because this lands on `orders.guest_label`, which
 * the pickup board renders on a wall the whole room can read.
 */
export default function NameStep() {
  const tokens = useTokens();
  const { flow, goNext } = useFlow();
  const { setGuestLabel } = useGuest();
  const [value, setValue] = useState('');

  const parsed = parseGuestLabel(value);
  const rejected = parsed.kind === 'rejected';
  const optional = flow.guestName.mode === 'optional';
  const canContinue = parsed.kind === 'ok' || (optional && parsed.kind === 'absent');

  function commit() {
    setGuestLabel(parsed.kind === 'ok' ? parsed.label : null);
    goNext();
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <StepHeading
        title="What name for the order?"
        hint={optional ? 'Optional — we can just call the number.' : undefined}
      />

      <TextInput
        value={value}
        onChangeText={setValue}
        autoFocus
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={MAX_GUEST_LABEL}
        accessibilityLabel="Name for the order"
        placeholder="Name"
        placeholderTextColor={tokens.textMuted}
        style={[styles.input, {
          color: tokens.textPrimary,
          fontFamily: tokens.fontBody,
          fontSize: tokens.type.hero,
          borderColor: rejected ? tokens.danger : tokens.textMuted,
          borderRadius: tokens.radius.lg,
          backgroundColor: tokens.surfaceElevated,
        }]}
      />

      <Text style={[styles.hint, {
        color: rejected ? tokens.danger : tokens.textMuted,
        fontFamily: tokens.fontBody, fontSize: tokens.type.md,
      }]}>
        {rejected
          ? parsed.reason === 'too-long'
            ? `Up to ${MAX_GUEST_LABEL} characters.`
            : 'Letters, numbers and simple punctuation.'
          : `${MAX_GUEST_LABEL - value.trim().length} characters left`}
      </Text>

      <View style={styles.actions}>
        <KioskPressable label="Continue" disabled={!canContinue} onPress={commit} />
        {optional ? (
          <KioskPressable label="Skip" variant="secondary" onPress={() => { setGuestLabel(null); goNext(); }} />
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingHorizontal: 48, gap: 18 },
  input: { width: 720, maxWidth: '100%', minHeight: 108, paddingHorizontal: 32, borderWidth: 2, textAlign: 'center' },
  hint: {},
  actions: { flexDirection: 'row', gap: 20, paddingTop: 10 },
});
