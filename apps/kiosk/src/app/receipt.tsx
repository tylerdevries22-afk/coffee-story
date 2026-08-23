import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTokens } from '@platform/ui';

import { useKioskSession } from '@/state/session';

/** How long the ticket stays up before the kiosk is ready for the next guest. */
const HANDOFF_MS = 6_000;

/**
 * The handoff.
 *
 * One number, large enough to read while walking away, and then the kiosk
 * returns to attract on its own. No "done" button: a guest who has paid is
 * already leaving, and a kiosk waiting to be dismissed is a kiosk out of
 * service until someone notices.
 */
export default function ReceiptScreen() {
  const tokens = useTokens();
  const router = useRouter();
  const { reset } = useKioskSession();

  // A placeholder until placeOrder is wired (C1); the real ticket comes back
  // with the order row, assigned by the database rather than guessed here.
  const ticket = 47;

  useEffect(() => {
    const id = setTimeout(() => { reset(); router.replace('/'); }, HANDOFF_MS);
    return () => clearTimeout(id);
  }, [reset, router]);

  return (
    <View style={[styles.root, { backgroundColor: tokens.surface }]}>
      <Text style={[styles.eyebrow, { color: tokens.textMuted }]}>Your order number</Text>
      <Text style={[styles.ticket, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay }]}>
        {ticket}
      </Text>
      <Text style={[styles.detail, { color: tokens.textMuted }]}>
        Watch the board — we&apos;ll call it when it&apos;s ready.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  eyebrow: { fontSize: 26, letterSpacing: 1.4, textTransform: 'uppercase' },
  ticket: { fontSize: 220, lineHeight: 240 },
  detail: { fontSize: 26 },
});
