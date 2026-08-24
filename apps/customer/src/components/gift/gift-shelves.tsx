import { Image } from 'expo-image';
import { useCallback, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Screen } from '@/components/ui';
import { CollapsingPageHeader } from '@/components/collapsing-page-header';
import {
  GIFT_AMOUNTS,
  GIFT_DESIGN_CATEGORIES,
  GIFT_FAQS,
  GIFT_QUANTITIES,
  type GiftDesign,
} from '@/data/gift-designs';
import { AppIcon, type AppIconName } from '@/components/icon';
import { disabledState, expandedState } from '@platform/ui';
import type { PaymentMethod } from '@platform/domain';
import { useTokens as useBrandTokens, type BrandTokens } from '@platform/ui';

/** Gift-card artwork is 3:2, matching the generated art. */
const CARD_RATIO = 2 / 3;

/** The Gift tab's storefront: a wallet banner over shelves of card artwork. */
export function GiftGallery({
  walletCount,
  onOpenWallet,
  onOpenInfo,
  onSelectDesign,
}: {
  walletCount: number;
  onOpenWallet: () => void;
  onOpenInfo: () => void;
  onSelectDesign: (design: GiftDesign) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const [scrollY] = useState(() => new Animated.Value(0));
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.setValue(event.nativeEvent.contentOffset.y);
  }, [scrollY]);

  return (
    <Screen
      contentContainerStyle={styles.galleryContent}
      stickyHeaderIndices={[0]}
      onScroll={onScroll}
      scrollEventThrottle={16}
    >
      <CollapsingPageHeader
        title="Gift Cards"
        scrollY={scrollY}
        flush
        actions={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="About digital gifting"
            onPress={onOpenInfo}
            hitSlop={8}
            style={({ pressed }) => [styles.infoButton, pressed && styles.pressed]}
          >
            <AppIcon name="info" size={20} tintColor={tokens.textPrimary} />
          </Pressable>
        )}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`My gift cards, ${walletCount} in your account`}
        onPress={onOpenWallet}
        style={({ pressed }) => [styles.wallet, compact && styles.walletCompact, pressed && styles.pressed]}
      >
        <View style={styles.walletCopy}>
          <Text style={styles.walletTitle}>My Gift Cards</Text>
          <Text style={styles.walletBody}>
            {walletCount
              ? `${walletCount} card${walletCount === 1 ? '' : 's'} in your account`
              : 'Digital gift cards you purchase and receive will appear here'}
          </Text>
        </View>
        <WalletStack compact={compact} />
      </Pressable>

      {GIFT_DESIGN_CATEGORIES.map((category) => (
        <GiftShelf key={category.title} title={category.title} designs={category.designs} compact={compact} onSelect={onSelectDesign} />
      ))}
    </Screen>
  );
}

/** The fanned card thumbnails on the wallet banner. Decorative only. */
function WalletStack({ compact }: { compact: boolean }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const [back, middle, front] = [
    GIFT_DESIGN_CATEGORIES[1]?.designs[0],
    GIFT_DESIGN_CATEGORIES[3]?.designs[0],
    GIFT_DESIGN_CATEGORIES[0]?.designs[0],
  ];
  return (
    <View style={[styles.stack, compact && styles.stackCompact]} pointerEvents="none">
      <StackCard design={back} placement={styles.stackBack} compact={compact} />
      <StackCard design={middle} placement={styles.stackMiddle} compact={compact} />
      <StackCard design={front} placement={styles.stackFront} compact={compact} />
    </View>
  );
}

function StackCard({ design, placement, compact }: { design?: GiftDesign; placement: StyleProp<ViewStyle>; compact: boolean }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  if (!design) return null;
  return (
    <View style={[styles.stackCard, compact && styles.stackCardCompact, placement]}>
      <Image source={design.art} style={styles.fillImage} contentFit="cover" alt="" />
    </View>
  );
}

function GiftShelf({
  title,
  designs,
  compact,
  onSelect,
}: {
  title: string;
  designs: readonly GiftDesign[];
  compact: boolean;
  onSelect: (design: GiftDesign) => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const { width } = useWindowDimensions();
  // Leaves the next card peeking, which is what invites the shelf to be scrolled.
  const cardWidth = Math.min(288, Math.round(width * 0.72));
  return (
    <View style={styles.shelf}>
      <Text accessibilityRole="header" style={[styles.shelfTitle, compact && styles.shelfInsetCompact]}>
        {title}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.shelfRow, compact && styles.shelfInsetCompact]}
      >
        {designs.map((design) => (
          <Pressable
            key={design.key}
            accessibilityRole="button"
            accessibilityLabel={`${design.name} gift card`}
            onPress={() => onSelect(design)}
            style={({ pressed }) => [
              styles.shelfCard,
              { width: cardWidth, height: Math.round(cardWidth * CARD_RATIO) },
              pressed && styles.pressed,
            ]}
          >
            <Image source={design.art} style={styles.fillImage} contentFit="cover" alt={design.name} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * The purchase sheet: pick an amount and a quantity, then pay. Recipient details
 * are deliberately absent — cards land in the buyer's wallet and are sent from
 * there, which is what "buy now, send later" means.
 */
export function GiftCardSheet({
  design,
  amount,
  quantity,
  pointsPerDollar,
  paymentMethod,
  loading,
  onAmountChange,
  onQuantityChange,
  onPaymentMethodChange,
  onClose,
  onPay,
}: {
  design: GiftDesign;
  amount: number;
  quantity: number;
  pointsPerDollar: number;
  paymentMethod: PaymentMethod | null;
  loading: boolean;
  onAmountChange: (amount: number) => void;
  onQuantityChange: (quantity: number) => void;
  onPaymentMethodChange: () => void;
  onClose: () => void;
  onPay: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const total = amount * quantity;
  return (
    <View style={styles.checkoutShell}>
      <Screen contentContainerStyle={styles.sheetContent}>
      <View style={styles.sheetHeader}>
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          Digital Gift Card
        </Text>
        <CloseButton onPress={onClose} label="Close gift card" />
      </View>

      <Image source={design.art} style={styles.sheetHero} contentFit="cover" alt={design.name} />

      <Text accessibilityRole="header" style={styles.sheetHeading}>
        Buy now, send later!
      </Text>
      <Text style={styles.sheetBody}>
        Digital gift cards appear under the Gift tab, ready to share whenever you choose.
      </Text>

      <View style={styles.selectRow}>
        <Stepper
          label="Amount"
          value={`$${amount.toFixed(2)}`}
          accessibilityLabel={`Amount, ${amount} dollars`}
          onPress={() => onAmountChange(nextIn(GIFT_AMOUNTS, amount))}
        />
        <Stepper
          label="Quantity"
          value={String(quantity)}
          accessibilityLabel={`Quantity, ${quantity}`}
          onPress={() => onQuantityChange(nextIn(GIFT_QUANTITIES, quantity))}
        />
      </View>

      <View style={styles.divider} />

      <Text accessibilityRole="header" style={styles.sheetSection}>
        Payment Method
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={paymentMethod ? `Card on file, ${paymentMethod.brand} ending in ${paymentMethod.last4}` : 'Card on file, no saved card'}
        onPress={onPaymentMethodChange}
        style={({ pressed }) => [styles.payMethod, pressed && styles.pressed]}
      >
        <View style={styles.payBadge}>
          <AppIcon name="creditcard" size={20} tintColor={tokens.textPrimary} />
        </View>
        <View style={styles.payCopy}>
          <Text style={styles.payName}>{paymentMethod ? `${paymentMethod.brand} •••• ${paymentMethod.last4}` : 'Card on file'}</Text>
          <Text style={styles.payMeta}>{paymentMethod ? `Expires ${paymentMethod.expirationMonth}/${paymentMethod.expirationYear}` : 'Add a card in Account settings'}</Text>
        </View>
        {paymentMethod ? <View style={styles.defaultChip}><Text style={styles.defaultChipText}>Default</Text></View> : null}
        <AppIcon name="chevron.right" size={15} tintColor={tokens.textMuted} />
      </Pressable>

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <View style={styles.totalLeader} />
        <Text style={styles.totalValue}>${total.toFixed(2)}</Text>
      </View>

      <View style={styles.earnBanner}>
        <AppIcon name="heart.fill" size={18} tintColor={tokens.primary} />
        <Text style={styles.earnText}>
          Earn {(total * pointsPerDollar).toLocaleString()} Beans for this order!
        </Text>
      </View>

      <Text style={styles.finePrint}>Digital gift card sales are final and non-refundable.</Text>
      </Screen>
      <View style={styles.checkoutFooter}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Pay ${total} dollars with Apple Pay`}
          {...disabledState(loading)}
          disabled={loading}
          onPress={onPay}
          style={({ pressed }) => [styles.applePayButton, pressed && styles.pressed, loading && styles.payButtonBusy]}
        >
          <Text style={styles.applePayText}>{loading ? 'Processing…' : `Pay  $${total.toFixed(2)}`}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** Cycles through the preset list, wrapping at the end. */
function nextIn(values: readonly number[], current: number): number {
  const index = values.indexOf(current);
  return values[(index + 1) % values.length] ?? values[0] ?? current;
}

function Stepper({
  label,
  value,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  value: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.selectGroup}>
      <Text style={styles.selectLabel}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Cycles to the next option"
        onPress={onPress}
        style={({ pressed }) => [styles.select, pressed && styles.pressed]}
      >
        <Text style={styles.selectValue}>{value}</Text>
        <AppIcon name="chevron.down" size={14} tintColor={tokens.textMuted} />
      </Pressable>
    </View>
  );
}

const HOW_IT_WORKS: readonly { symbol: AppIconName; title: string; body: string }[] = [
  {
    symbol: 'creditcard',
    title: 'Buy a Digital Gift Card',
    body: 'Pick a design and add it to your account.',
  },
  {
    symbol: 'qrcode',
    title: 'Use Your Gift Card',
    body: 'Pay in the app or show the code at the studio.',
  },
  {
    symbol: 'paperplane',
    title: 'Send as a Gift',
    body: 'Share with anyone by link — they can redeem it as a guest or add it to their Coffee Story account.',
  },
];

/** The sheet behind the header's info button. */
export function GiftInfoSheet({ onClose }: { onClose: () => void }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  return (
    <Screen contentContainerStyle={styles.sheetContent}>
      <View style={styles.sheetHeader}>
        <View style={styles.infoTitleGroup}>
          <Text accessibilityRole="header" style={styles.pageTitle}>
            Digital Gifting
          </Text>
          <Text style={styles.sheetBody}>Buy now, send later!</Text>
        </View>
        <CloseButton onPress={onClose} label="Close digital gifting" />
      </View>

      <ChipHeading>How it works</ChipHeading>
      {HOW_IT_WORKS.map((step) => (
        <View key={step.title} style={styles.step}>
          <AppIcon name={step.symbol} size={24} tintColor={tokens.textPrimary} />
          <View style={styles.stepCopy}>
            <Text style={styles.stepTitle}>{step.title}</Text>
            <Text style={styles.stepBody}>{step.body}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.finePrint}>Digital gift card sales are final and non-refundable.</Text>

      <View style={styles.divider} />

      <ChipHeading>FAQs</ChipHeading>
      {GIFT_FAQS.map((faq) => {
        const open = openFaq === faq.question;
        return (
          <Pressable
            key={faq.question}
            accessibilityRole="button"
            {...expandedState(open)}
            onPress={() => setOpenFaq(open ? null : faq.question)}
            style={({ pressed }) => [styles.faq, pressed && styles.pressed]}
          >
            <View style={styles.faqRow}>
              <View style={styles.faqBadge}>
                <Text style={styles.faqBadgeText}>?</Text>
              </View>
              <Text style={styles.faqQuestion}>{faq.question}</Text>
              <AppIcon
                name={open ? 'chevron.down' : 'chevron.right'}
                size={15}
                tintColor={tokens.textMuted}
              />
            </View>
            {open ? <Text style={styles.faqAnswer}>{faq.answer}</Text> : null}
          </Pressable>
        );
      })}
    </Screen>
  );
}

function ChipHeading({ children }: { children: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <View style={styles.chipHeading}>
      <Text accessibilityRole="header" style={styles.chipHeadingText}>
        {children}
      </Text>
    </View>
  );
}

function CloseButton({ onPress, label }: { onPress: () => void; label: string }) {
  const tokens = useBrandTokens();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
    >
      <AppIcon name="xmark" size={17} tintColor={tokens.textPrimary} />
    </Pressable>
  );
}

const createStyles = (tokens: BrandTokens) => StyleSheet.create({
  checkoutShell: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 80,
    backgroundColor: tokens.surface,
  },
  galleryContent: { paddingTop: 0, paddingHorizontal: 0, gap: tokens.spacing.xl },
  pressed: { opacity: 0.85 },
  infoFallback: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 15 },

  headerRow: {
    paddingHorizontal: tokens.spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacing.lg,
  },
  pageTitle: {
    color: tokens.textPrimary,
    fontFamily: tokens.fontDisplay,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1,
  },
  infoButton: {
    width: 40,
    height: 40,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    borderColor: tokens.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  wallet: {
    marginHorizontal: tokens.spacing.xl,
    minHeight: 116,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
    paddingLeft: tokens.spacing.lg,
    paddingRight: tokens.spacing.md,
    paddingVertical: tokens.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
    overflow: 'hidden',
  },
  walletCompact: { marginHorizontal: tokens.spacing.lg, minHeight: 108, paddingLeft: 14, paddingRight: tokens.spacing.sm, gap: tokens.spacing.sm },
  walletCopy: { flex: 1, minWidth: 0, gap: tokens.spacing.sm },
  walletTitle: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 21, letterSpacing: -0.4 },
  walletBody: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14, lineHeight: 19 },
  stack: { width: 116, height: 92 },
  stackCompact: { width: 92, height: 78 },
  stackCard: {
    position: 'absolute',
    width: 78,
    height: 52,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: tokens.surfaceElevated,
    overflow: 'hidden',
    backgroundColor: tokens.surface,
  },
  stackCardCompact: { width: 64, height: 43 },
  stackBack: { top: 0, right: 4, transform: [{ rotate: '-12deg' }] },
  stackMiddle: { top: 18, right: 26, transform: [{ rotate: '6deg' }] },
  stackFront: { top: 36, right: 2, transform: [{ rotate: '-4deg' }] },

  // Sized rather than absolutely inset: expo-image renders its <img> inside its
  // own statically-positioned wrapper on web, so `StyleSheet.absoluteFill` on
  // the Image escapes to a distant ancestor and the artwork never appears.
  fillImage: { width: '100%', height: '100%' },

  shelf: { gap: tokens.spacing.md },
  shelfTitle: {
    paddingHorizontal: tokens.spacing.xl,
    color: tokens.textPrimary,
    fontFamily: tokens.fontDisplay,
    fontSize: 23,
    letterSpacing: -0.5,
  },
  shelfRow: { paddingHorizontal: tokens.spacing.xl, gap: tokens.spacing.md },
  shelfInsetCompact: { paddingHorizontal: tokens.spacing.lg },
  shelfCard: {
    borderRadius: tokens.radius.lg,
    overflow: 'hidden',
    backgroundColor: tokens.surface,
    shadowColor: tokens.textPrimary, shadowOffset: { width: 0, height: 8 }, shadowOpacity: tokens.elevation.card, shadowRadius: 24, elevation: 5,
  },

  sheetContent: { paddingHorizontal: tokens.spacing.xl, gap: tokens.spacing.lg, paddingBottom: 140 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: tokens.spacing.lg },
  infoTitleGroup: { flex: 1, gap: tokens.spacing.sm },
  sheetTitle: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 26, letterSpacing: -0.6 },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHero: { width: '100%', aspectRatio: 3 / 2, borderRadius: tokens.radius.lg, backgroundColor: tokens.surface },
  sheetHeading: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 27, letterSpacing: -0.6 },
  sheetBody: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 15, lineHeight: 21 },

  selectRow: { flexDirection: 'row', gap: tokens.spacing.lg },
  selectGroup: { flex: 1, gap: tokens.spacing.sm },
  selectLabel: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 14 },
  select: {
    minHeight: 56,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surface,
    paddingHorizontal: tokens.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 19 },

  divider: { height: 1, backgroundColor: tokens.surface, marginVertical: tokens.spacing.md },
  sheetSection: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 21, letterSpacing: -0.4 },
  payMethod: {
    minHeight: 68,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.surface,
    paddingHorizontal: tokens.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
  },
  payCopy: { flex: 1, gap: 2 },
  payBadge: {
    width: 52,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payName: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16 },
  payMeta: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 12 },
  defaultChip: {
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surface,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: 5,
  },
  defaultChipText: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 13 },

  totalRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md, marginTop: tokens.spacing.md },
  totalLabel: { color: tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: 22, letterSpacing: -0.4 },
  totalLeader: {
    flex: 1,
    height: 1,
    borderBottomWidth: 1,
    borderStyle: 'dashed',
    borderColor: tokens.surface,
  },
  totalValue: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 21 },

  earnBanner: {
    minHeight: 58,
    borderRadius: tokens.radius.lg,
    backgroundColor: tokens.surface,
    paddingHorizontal: tokens.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.spacing.md,
  },
  earnText: { flex: 1, color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 15 },

  checkoutFooter: {
    position: 'absolute',
    left: tokens.spacing.xl,
    right: tokens.spacing.xl,
    bottom: tokens.spacing.xl,
  },
  applePayButton: {
    minHeight: 56,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: tokens.spacing.xl,
  },
  applePayText: { color: tokens.surfaceElevated, fontFamily: tokens.fontBody, fontSize: 17 },
  payButtonBusy: { opacity: 0.7 },
  finePrint: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 13, lineHeight: 18 },

  chipHeading: {
    alignSelf: 'flex-start',
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.surface,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: 6,
    marginTop: tokens.spacing.md,
  },
  chipHeadingText: { color: tokens.primary, fontFamily: tokens.fontDisplay, fontSize: 20, letterSpacing: -0.3 },

  step: { flexDirection: 'row', gap: tokens.spacing.lg, alignItems: 'flex-start' },
  stepCopy: { flex: 1, gap: 2 },
  stepTitle: { color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 17 },
  stepBody: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 15, lineHeight: 21 },

  faq: {
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.surface,
    padding: tokens.spacing.lg,
    gap: tokens.spacing.md,
  },
  faqRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.spacing.md },
  faqBadge: {
    width: 26,
    height: 26,
    borderRadius: tokens.radius.pill,
    backgroundColor: tokens.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faqBadgeText: { color: tokens.primary, fontFamily: tokens.fontBody, fontSize: 14 },
  faqQuestion: { flex: 1, color: tokens.textPrimary, fontFamily: tokens.fontBody, fontSize: 16, lineHeight: 21 },
  faqAnswer: { color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: 15, lineHeight: 21 },
});
