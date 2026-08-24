import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useTokens } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import type { KioskMenuStatus } from '@/data/menu-store';

/**
 * What a kiosk shows when it has no menu to show.
 *
 * The alternative was falling back to the bundled catalog, which is one
 * tenant's menu: a franchise whose kiosk lost its connection would quietly
 * start selling another shop's drinks at another shop's prices, under its own
 * logo, with nothing on screen to say so. A guest cannot detect that. They can
 * read this.
 *
 * The retry is manual as well as automatic. The provider is already backing
 * off behind this screen; the button is for the barista who just fixed the
 * wifi and does not want to wait out the interval.
 */
export function MenuUnavailable({
  status, onRetry,
}: {
  status: KioskMenuStatus;
  onRetry: () => void;
}) {
  const tokens = useTokens();
  const loading = status === 'loading';
  const paused = status === 'paused';

  return (
    <View style={[styles.root, { gap: tokens.spacing.md, paddingHorizontal: tokens.spacing.xxl }]}>
      {loading ? <ActivityIndicator size="large" color={tokens.primary} /> : null}
      <Text
        style={[styles.centered, {
          color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.display,
        }]}
      >
        {loading ? 'One moment' : paused ? 'Ordering is paused' : 'Ordering is offline'}
      </Text>
      <Text
        style={[styles.body, {
          color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.lg,
        }]}
      >
        {loading
          ? 'Loading today’s menu.'
          : paused
            ? 'The shop has temporarily paused new orders. Please ask at the counter.'
            : 'This kiosk cannot reach the menu right now. Please order at the counter — we’ll keep trying.'}
      </Text>
      {loading || paused ? null : <KioskPressable label="Try again" onPress={onRetry} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centered: { textAlign: 'center' },
  body: { textAlign: 'center', maxWidth: 560, lineHeight: 28 },
});
