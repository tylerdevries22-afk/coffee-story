import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useTokens } from '@platform/ui';

import * as haptics from '@/lib/haptics';
import { KioskPressable } from '@/components/chrome/kiosk-pressable';

/**
 * What a guest sees if the flow ever routes somewhere that is not there.
 *
 * Expo Router's own Unmatched Route screen is a development affordance: it
 * offers a `/_sitemap` link and prints the raw deep-link scheme. On a tablet
 * bolted to a wall in a lobby, that is both confusing and a small disclosure,
 * so this replaces it with the tenant's own surface and the only action that
 * can possibly help -- start again.
 *
 * It should be unreachable. It exists because "should be" is not a guarantee on
 * a screen nobody is standing next to.
 */
export default function NotFoundScreen() {
  const tokens = useTokens();
  const router = useRouter();

  return (
    <View style={[styles.root, { backgroundColor: tokens.surface }]}>
      <Text
        style={[styles.title, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.hero }]}
      >
        Let&apos;s start again
      </Text>
      <Text
        style={[styles.detail, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.lg }]}
      >
        Something went the wrong way. Nothing has been ordered.
      </Text>
      <KioskPressable
        label="Start a new order"
        onPress={() => { haptics.tapped(); router.replace('/'); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 48 },
  title: { textAlign: 'center' },
  detail: { textAlign: 'center' },
});
