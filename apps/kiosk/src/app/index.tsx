import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCopy, useTokens } from '@platform/ui';

import { useKioskSession } from '@/state/session';

/**
 * The attract screen.
 *
 * What a kiosk shows for most of its life, so it is the shop's face more than
 * a menu is. The whole surface is the button: a guest walking up should not
 * have to find a target, and "touch anywhere" is the only affordance that
 * works from six feet away.
 */
export default function AttractScreen() {
  const tokens = useTokens();
  const copy = useCopy();
  const router = useRouter();
  const { reset } = useKioskSession();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Start an order"
      onPress={() => { reset(); router.replace('/order/entry'); }}
      style={[styles.root, { backgroundColor: tokens.surface }]}
    >
      <View style={styles.center}>
        <Text style={[styles.brand, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay }]}>
          {copy('appName')}
        </Text>
        <Text style={[styles.invite, { color: tokens.textMuted, fontFamily: tokens.fontBody }]}>
          {copy('orderCta')}
        </Text>
      </View>
      <View style={[styles.rule, { backgroundColor: tokens.accent }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', gap: 24 },
  // Sized for someone deciding whether to walk over, not someone already here.
  brand: { fontSize: 96, letterSpacing: -1 },
  invite: { fontSize: 34 },
  rule: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 6 },
});
