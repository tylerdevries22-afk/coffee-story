import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import {
  formatMoney,
  orderItemCount,
  orderLineTotalCents,
  orderSubtotalCents,
  orderTotals,
} from '@platform/domain';
import { EASING, duration, useCopy, useReducedMotion, useTokens, withAlpha } from '@platform/ui';

import { KioskPressable } from '@/components/chrome/kiosk-pressable';
import { KioskStepper } from '@/components/chrome/kiosk-stepper';
import { styles } from '@/components/cart-drawer-styles';
import { KioskMenuImage } from '@/components/menu-image';
import { useCartDrawerFocus } from '@/components/use-cart-drawer-focus';
import { useKioskMenu } from '@/data/menu-store';
import { checkoutEntryStep } from '@/features/cart-drawer';
import * as haptics from '@/lib/haptics';
import { useFlow } from '@/state/flow';
import { useKioskSession } from '@/state/session';
import { TENANT } from '@/tenant';
import { TENANT_TAX } from '@/tenant/tax';

/** A transient cart surface that preserves the menu underneath it. */
export function KioskCartDrawer() {
  const tokens = useTokens();
  const copy = useCopy();
  const reduced = useReducedMotion();
  const { cart, changeQuantity, removeLine } = useKioskSession();
  const { menu } = useKioskMenu();
  const { flow, closeCart, goTo, learn } = useFlow();
  const progress = useSharedValue(reduced ? 1 : 0);
  const imageUrlBySlug = useMemo(
    () => new Map(menu.items.map((item) => [item.id, item.imageUrl] as const)),
    [menu.items],
  );
  const totals = orderTotals({
    subtotalCents: orderSubtotalCents(cart),
    jurisdictions: TENANT_TAX,
  });
  const count = orderItemCount(cart);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: duration(tokens.motion.base, reduced),
      easing: Easing.bezier(...EASING.enter),
    });
  }, [progress, reduced, tokens.motion.base]);

  const { dismissCart, drawerRef } = useCartDrawerFocus(closeCart);

  const backdrop = useAnimatedStyle(() => ({ opacity: progress.value }));
  const drawer = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.value) * 480 }],
  }));

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Animated.View
        accessibilityElementsHidden
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.backdrop, backdrop]}
      >
        <Pressable
          accessible={false}
          onPress={dismissCart}
          style={[styles.backdropPress, { backgroundColor: withAlpha(tokens.textPrimary, 0.36) }]}
        />
      </Animated.View>

      <Animated.View
        testID="kiosk-cart-drawer"
        accessibilityViewIsModal
        aria-labelledby="kiosk-cart-title"
        aria-modal
        onAccessibilityEscape={dismissCart}
        role="dialog"
        style={[
          styles.drawer,
          {
            backgroundColor: tokens.surfaceElevated,
            shadowColor: tokens.textPrimary,
            shadowOpacity: tokens.elevation.raised,
          },
          drawer,
        ]}
      >
        <View ref={drawerRef} collapsable={false} style={styles.drawerContents}>
          <View style={styles.heading}>
            <View style={styles.headingCopy}>
              <Text
                accessibilityRole="header"
                nativeID="kiosk-cart-title"
                style={[styles.title, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.xxl }]}
              >
                Your order
              </Text>
              <Text style={[styles.countText, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>
                {count} {count === 1 ? 'item' : 'items'}
              </Text>
            </View>
            <Pressable
              testID="kiosk-cart-close-button"
              accessibilityRole="button"
              accessibilityLabel="Close cart"
              onPress={() => { haptics.tapped(); dismissCart(); }}
              style={[styles.close, { borderColor: tokens.textMuted, borderRadius: tokens.radius.pill }]}
            >
              <Text style={[styles.closeLabel, { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>Close</Text>
            </Pressable>
          </View>

          {cart.lines.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.lg }]}>Your cart is empty.</Text>
              <KioskPressable label="Keep shopping" variant="secondary" onPress={dismissCart} />
            </View>
          ) : (
            <>
              <ScrollView contentContainerStyle={styles.lines} showsVerticalScrollIndicator={false}>
                {cart.lines.map((line) => (
                  <View key={line.id} style={[styles.line, { borderBottomColor: withAlpha(tokens.textMuted, 0.24) }]}>
                    <KioskMenuImage
                      request={{
                        imageSlug: line.itemId,
                        imageUrl: imageUrlBySlug.get(line.itemId),
                        monogram: TENANT.business?.monogram,
                        label: line.name,
                      }}
                      variant="kioskLine"
                      alt=""
                    />
                    <View style={styles.lineBody}>
                      <View style={styles.lineTop}>
                        <View style={styles.lineCopy}>
                          <Text numberOfLines={2} style={[styles.lineName, { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>{line.name}</Text>
                          <Text numberOfLines={2} style={[styles.lineMeta, { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.sm }]}>{line.optionSummary || line.sizeLabel}</Text>
                        </View>
                        <Text style={[styles.linePrice, { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: tokens.type.md }]}>{formatMoney(orderLineTotalCents(line))}</Text>
                      </View>
                      <KioskStepper
                        value={line.quantity}
                        min={0}
                        label={line.name}
                        onChange={(next) => {
                          if (next <= 0) removeLine(line.id);
                          else changeQuantity(line.id, next - line.quantity);
                          learn({ bagCount: next <= 0 ? cart.lines.length - 1 : cart.lines.length });
                        }}
                      />
                    </View>
                  </View>
                ))}
              </ScrollView>

              <View style={[styles.summary, { borderTopColor: withAlpha(tokens.textMuted, 0.24) }]}>
                <MoneyRow label="Subtotal" amount={totals.subtotalCents} />
                {totals.taxRows.map((row) => <MoneyRow key={row.id} label={row.label} amount={row.amountCents} muted />)}
                <View style={styles.totalRow}>
                  <Text style={[styles.totalLabel, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.xl }]}>Total</Text>
                  <Text style={[styles.totalAmount, { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.xl }]}>{formatMoney(totals.totalCents)}</Text>
                </View>
                <KioskPressable label="Keep shopping" variant="secondary" onPress={dismissCart} />
                <KioskPressable
                  label={copy('checkoutTitle')}
                  trailing={formatMoney(totals.totalCents)}
                  onPress={() => {
                    haptics.landed();
                    closeCart();
                    goTo(checkoutEntryStep(flow));
                  }}
                />
              </View>
            </>
          )}
        </View>
      </Animated.View>
    </View>
  );
}

function MoneyRow({ label, amount, muted = false }: { label: string; amount: number; muted?: boolean }) {
  const tokens = useTokens();
  const color = muted ? tokens.textMuted : tokens.textPrimary;
  return (
    <View style={styles.moneyRow}>
      <Text numberOfLines={1} style={[styles.moneyLabel, { color, fontFamily: tokens.fontBody, fontSize: tokens.type.sm }]}>{label}</Text>
      <Text style={[styles.moneyAmount, { color, fontFamily: tokens.fontBody, fontSize: tokens.type.sm }]}>{formatMoney(amount)}</Text>
    </View>
  );
}
