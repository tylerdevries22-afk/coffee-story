import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { disabledState, useCopy, useTokens } from '@platform/ui';

import { resetExperience } from '@/features/experience-reset';
import { useBuilder } from '@/state/builder';
import { useDevice } from '@/state/device';
import { useFlow } from '@/state/flow';
import { useGuest } from '@/state/guest';
import { useKioskSession } from '@/state/session';

import tenantLogo from '../../assets/brand/logo.png';

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
  const { clear: clearGuest } = useGuest();
  const builder = useBuilder();
  const device = useDevice();
  const { flow, beginOrder } = useFlow();
  const preview = Platform.OS === 'web' && device.status === 'unpaired';
  const canOrder = device.status === 'ready' || preview;
  const setupNeeded = device.status === 'unpaired' || device.status === 'revoked';

  function startOrder() {
    resetExperience({
      resetSession: reset,
      clearGuest,
      resetBuilder: builder.reset,
      navigate: beginOrder,
    });
  }

  return (
    <View style={[styles.root, { backgroundColor: tokens.surface }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start an order"
        {...disabledState(!canOrder)}
        disabled={!canOrder}
        onPress={startOrder}
        style={styles.start}
      >
        <View style={[styles.center, { gap: tokens.spacing.xl }]}>
          {flow.attract.showLogo ? (
            <Image
              source={tenantLogo}
              contentFit="contain"
              alt=""
              style={{ width: tokens.type.ticket, height: tokens.type.ticket }}
            />
          ) : null}
          <Text style={[styles.brand, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.mega }]}>
            {flow.attract.headline ?? copy('appName')}
          </Text>
          <Text style={[styles.invite, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xxl }]}>
            {canOrder
              ? flow.attract.invite
              : device.status === 'loading'
                ? 'Checking this kiosk…'
                : 'Set up this kiosk before taking an order.'}
          </Text>
          {preview ? (
            <Text style={[styles.preview, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>
              Local preview · orders are not sent
            </Text>
          ) : null}
        </View>
      </Pressable>
      {/* Offered only while the tablet is unpaired, and deliberately small: a
          guest walking up should see an invitation to order, not a setup task.
          Once paired it disappears entirely. */}
      {setupNeeded ? (
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  start: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center' },
  // Sized for someone deciding whether to walk over, not someone already here.
  brand: { letterSpacing: -1 },
  invite: {},
  preview: { textTransform: 'uppercase', letterSpacing: 1.1 },
  rule: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 6 },
  setup: { position: 'absolute', bottom: 28, right: 28, minHeight: 60, justifyContent: 'center' },
  setupLabel: {},
});
