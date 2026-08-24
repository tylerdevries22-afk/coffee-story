import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTokens } from '@platform/ui';
import { useRouter } from 'expo-router';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { StepHeading } from '@/components/chrome/step-heading';
import * as haptics from '@/lib/haptics';
import { useDevice } from '@/state/device';

/**
 * Exactly the alphabet `newPairingCode` draws from -- Crockford base32 minus
 * vowels, so no I/O/0/1 to misread and no word a barista has to say out loud.
 *
 * The digits 2-9 are IN this string, which is the point: an earlier cut of this
 * screen added a separate 0-9 numeric row, and offering a 0 or a 1 that can
 * never appear in a code is worse than not offering them -- a guest who types
 * one gets a code that cannot be right and no explanation why.
 */
const CODE_KEYS = '23456789BCDFGHJKMNPQRSTVWXZ'.split('');
const EDIT_KEYS = ['CLR', 'DEL'] as const;

/**
 * Setting the tablet up, once.
 *
 * A member of staff mints a code in the console and types it here. The code is
 * eight characters from an alphabet with no vowels and no I/O/0/1, so it can be
 * read off a screen and said out loud without ambiguity -- this keypad offers
 * exactly that alphabet and nothing else, which removes the whole class of
 * "is that a zero or an O" support call.
 *
 * Not reachable from the ordering flow: a guest has no business here, so it is
 * its own route outside the `(flow)` group and is only offered on the attract
 * screen while the tablet is unpaired.
 */
export default function PairScreen() {
  const tokens = useTokens();
  const router = useRouter();
  const device = useDevice();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await device.pair(code);
    setBusy(false);
    if (result.ok) {
      haptics.completed();
      router.replace('/');
      return;
    }
    haptics.refused();
    setError(result.error);
  }

  return (
    <View style={[styles.root, { backgroundColor: tokens.surface }]}>
      <StepHeading
        title="Set up this kiosk"
        hint="Enter the pairing code from the console. It is good for fifteen minutes."
      />

      <Text
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${code.length} of 8 characters entered`}
        style={[styles.code, { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.hero }]}
      >
        {code.padEnd(8, '·')}
      </Text>

      <View style={styles.pad}>
        {[...CODE_KEYS, ...EDIT_KEYS].map((key) => (
          <KioskPressable
            key={key}
            label={key}
            variant="secondary"
            onPress={() => {
              setError(null);
              if (key === 'DEL') setCode((current) => current.slice(0, -1));
              else if (key === 'CLR') setCode('');
              else setCode((current) => (current.length >= 8 ? current : current + key));
            }}
          />
        ))}
      </View>

      {error ? (
        <Text style={[styles.error, { color: tokens.danger, fontFamily: tokens.fontBody, fontSize: tokens.type.lg }]}>
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <KioskPressable
          label={busy ? 'Pairing…' : 'Pair this kiosk'}
          disabled={busy || code.length !== 8}
          onPress={() => void submit()}
        />
        <KioskPressable label="Not now" variant="secondary" onPress={() => router.replace('/')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', paddingHorizontal: 32, paddingTop: 12, gap: 12 },
  code: { letterSpacing: 10 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', maxWidth: 1100 },
  error: { textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 16, paddingTop: 8 },
});
