import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useCopy, useTokens } from '@platform/ui';

import { useDevice } from '@/state/device';
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
  const device = useDevice();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Start an order"
      onPress={() => { reset(); router.replace('/order/entry'); }}
      style={[styles.root, { backgroundColor: tokens.surface }]}
    >
      <View style={[styles.center, { gap: tokens.spacing.xl }]}>
        <Text style={[styles.brand, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.mega }]}>
          {copy('appName')}
        </Text>
        <Text style={[styles.invite, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xxl }]}>
          {copy('orderCta')}
        </Text>
      </View>
      {/* Offered only while the tablet is unpaired, and deliberately small: a
          guest walking up should see an invitation to order, not a setup task.
          Once paired it disappears entirely. */}
      {device.status === 'unpaired' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Set up this kiosk"
          onPress={() => router.push('/pair')}
          style={[styles.setup, { paddingHorizontal: tokens.spacing.lg }]}
        >
          <Text style={[styles.setupLabel, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>
            Set up this kiosk
          </Text>
        </Pressable>
      ) : null}
      <View style={[styles.rule, { backgroundColor: tokens.accent }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center' },
  // Sized for someone deciding whether to walk over, not someone already here.
  brand: { letterSpacing: -1 },
  invite: {},
  rule: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 6 },
  setup: { position: 'absolute', bottom: 28, right: 28, minHeight: 60, justifyContent: 'center' },
  setupLabel: {},
});
