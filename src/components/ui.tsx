import { createContext, useContext, type PropsWithChildren, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type PressableProps,
  type ScrollViewProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, radius, shadow, spacing } from '@/theme/tokens';
import type { AppIconName } from '@/components/icon-map';
import { AppIcon } from '@/components/icon';
import { tabState } from '@/lib/a11y-state';

/**
 * Surface tone. `deep` is the plum the web admin portal uses for its sidebar
 * (--surface-deep). `admin` and `staff` are the lighter workspace plums: each
 * role's More page and every page opened from it share one surface, and staff
 * sits a step lighter than admin so the two workspaces read apart at a glance.
 *
 * Tone travels by context rather than by prop so a screen can opt in once and
 * every primitive below it inverts, instead of every call site having to pass a
 * tone it doesn't care about.
 */
export type SurfaceTone = 'light' | 'deep' | 'admin' | 'staff';
const ToneContext = createContext<SurfaceTone>('light');

export function useSurfaceTone(): SurfaceTone {
  return useContext(ToneContext);
}

/**
 * Cards and rows on the lighter workspaces are translucent white rather than a
 * fixed plum: one overlay reads correctly on both surfaces, and white body text
 * keeps its contrast because the surface underneath never gets lighter than
 * brand400.
 */
const TONE_SURFACES: Record<Exclude<SurfaceTone, 'light'>, {
  screen: string;
  panel: string;
  border: string;
  /** Secondary copy, tuned per surface: what reads as "muted" against
   *  near-black plum disappears against the pale workspace washes. */
  body: string;
  muted: string;
  /** True when the surface needs white-on-dark text and controls. */
  onDark: boolean;
}> = {
  deep: {
    screen: colors.brand900,
    panel: colors.brand800,
    border: colors.brand700,
    body: colors.brand200,
    muted: colors.brand300,
    onDark: true,
  },
  admin: {
    screen: colors.brand100,
    panel: 'rgba(255,255,255,0.72)',
    border: 'rgba(70,48,78,0.12)',
    body: colors.ink700,
    muted: colors.ink600,
    onDark: false,
  },
  staff: {
    screen: colors.brand50,
    panel: 'rgba(255,255,255,0.82)',
    border: 'rgba(70,48,78,0.10)',
    body: colors.ink700,
    muted: colors.ink600,
    onDark: false,
  },
};

/**
 * Whether the current surface needs white-on-dark treatment. Components used
 * across personas branch on this rather than on `tone !== 'light'`: the
 * workspace tones are pale washes now, so light-vs-workspace no longer implies
 * dark-vs-light text.
 */
export function useOnDarkSurface(): boolean {
  const surface = surfaceOf(useSurfaceTone());
  return surface?.onDark ?? false;
}

/** Every tone except `light` inverts its text to the white-on-plum treatment. */
function surfaceOf(tone: SurfaceTone) {
  return tone === 'light' ? null : TONE_SURFACES[tone];
}

export function Screen({
  children,
  tone = 'light',
  ...props
}: PropsWithChildren<ScrollViewProps & { tone?: SurfaceTone }>) {
  const insets = useSafeAreaInsets();
  const surface = surfaceOf(tone);
  return (
    <ToneContext.Provider value={tone}>
      <ScrollView
        {...props}
        style={[styles.screen, surface ? { backgroundColor: surface.screen } : null, props.style]}
        contentContainerStyle={[styles.screenContent, { paddingTop: insets.top + spacing.md }, props.contentContainerStyle]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </ToneContext.Provider>
  );
}

export function StaticScreen({ children }: PropsWithChildren) {
  return <SafeAreaView style={styles.staticScreen}>{children}</SafeAreaView>;
}

export function Title({ children, style }: PropsWithChildren<{ style?: StyleProp<TextStyle> }>) {
  const tone = useSurfaceTone();
  const surface = surfaceOf(tone);
  const deep = surface?.onDark ?? false;
  return <Text style={[styles.title, deep && styles.titleDeep, style]}>{children}</Text>;
}

export function SectionTitle({ children }: PropsWithChildren) {
  const tone = useSurfaceTone();
  const surface = surfaceOf(tone);
  const deep = surface?.onDark ?? false;
  return <Text style={[styles.sectionTitle, deep && styles.sectionTitleDeep]}>{children}</Text>;
}

export function Body({ children, muted = false }: PropsWithChildren<{ muted?: boolean }>) {
  const surface = surfaceOf(useSurfaceTone());
  if (surface) return <Text style={[styles.body, { color: muted ? surface.muted : surface.body }]}>{children}</Text>;
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Eyebrow({ children }: PropsWithChildren) {
  const surface = surfaceOf(useSurfaceTone());
  return <Text style={[styles.eyebrow, surface ? { color: surface.muted } : null]}>{children}</Text>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const surface = surfaceOf(useSurfaceTone());
  return (
    <View
      style={[
        styles.card,
        surface ? { backgroundColor: surface.panel, borderColor: surface.border } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <StaticScreen>
      <View style={styles.stateWrap}>
        <View style={styles.stateMark}><ActivityIndicator color={colors.brand700} /></View>
        <Title>One moment.</Title>
        <Body muted>{label}</Body>
      </View>
    </StaticScreen>
  );
}

export function ErrorState({ title = 'Something went quiet.', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <StaticScreen>
      <View style={styles.stateWrap}>
        <View style={styles.stateMark}><Text style={styles.stateMarkText}>FH</Text></View>
        <Title>{title}</Title>
        <Body muted>{message}</Body>
        {onRetry ? <Button label="Try again" onPress={onRetry} /> : null}
      </View>
    </StaticScreen>
  );
}

type ButtonProps = Omit<PressableProps, 'onPress'> & {
  label: string;
  variant?: 'primary' | 'secondary' | 'soft';
  loading?: boolean;
  onPress: NonNullable<PressableProps['onPress']>;
};

export function Button({ label, variant = 'primary', loading, disabled, style, ...props }: ButtonProps) {
  const tone = useSurfaceTone();
  const surface = surfaceOf(tone);
  const deep = surface?.onDark ?? false;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      {...props}
      // `style` must be pulled out of props and merged in LAST. It used to arrive
      // via {...props} and was then overwritten by this prop, so every caller's
      // style was silently discarded -- including the `flex: 1` on the paired
      // Set Up/Exit to Website row, which left those buttons overflowing their
      // row container on narrow screens instead of sharing the width.
      style={(state) => [
        styles.button,
        variant === 'secondary' && styles.secondaryButton,
        variant === 'soft' && styles.softButton,
        deep && styles.buttonDeep,
        deep && variant === 'secondary' && { backgroundColor: 'transparent', borderColor: surface?.border },
        deep && variant === 'soft' && { backgroundColor: surface?.panel },
        state.pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      {loading ? <ActivityIndicator color={colors.white} /> : (
        <Text
          style={[
            styles.buttonText,
            variant !== 'primary' && styles.secondaryButtonText,
            deep && variant !== 'primary' && { color: surface?.body },
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

type RowProps = {
  title: string;
  subtitle?: string;
  // Any mapped icon: this list had drifted behind icon-map, so callers with a
  // valid symbol were rejected for no reason.
  symbol?: AppIconName;
  /**
   * A raster image instead of an SF Symbol — used by the My Rewards row, whose
   * cup mark has no symbol equivalent and matches the Rewards tab icon.
   */
  iconSrc?: ImageSourcePropType;
  value?: ReactNode;
  onPress?: () => void;
};

export function PillRow({ title, subtitle, symbol, iconSrc, value, onPress }: RowProps) {
  const tone = useSurfaceTone();
  const surface = surfaceOf(tone);
  const deep = surface?.onDark ?? false;
  const content = (
    <>
      {iconSrc ? (
        <Image source={iconSrc} style={styles.rowImage} resizeMode="contain" alt="" />
      ) : symbol ? (
        <AppIcon name={symbol} size={24} tintColor={deep ? colors.brand300 : colors.brand700} />
      ) : null}
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, deep && styles.rowTitleDeep]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSubtitle, surface ? { color: surface.muted } : null]}>{subtitle}</Text> : null}
      </View>
      {value ?? (onPress ? <AppIcon name="chevron.right" size={15} tintColor={deep ? colors.brand400 : colors.ink400} /> : null)}
    </>
  );
  const rowStyle = [
    styles.pillRow,
    surface ? { backgroundColor: surface.panel, borderColor: surface.border } : null,
  ];
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [...rowStyle, pressed && styles.pressed]}>
      {content}
    </Pressable>
  ) : <View style={rowStyle}>{content}</View>;
}

/**
 * The shared More-page footer: two legal pills side by side, then the version
 * pill with the brand mark and a small mode caption underneath. One component
 * for every persona's More page so the client, staff and owner footers cannot
 * drift apart; colors follow the surrounding surface tone.
 */
export function MoreFooter({
  onPrivacy,
  onTerms,
  version,
  caption,
  iconSrc,
}: {
  onPrivacy: () => void;
  onTerms: () => void;
  version: string;
  caption: string;
  iconSrc: ImageSourcePropType;
}) {
  const tone = useSurfaceTone();
  const surface = surfaceOf(tone);
  const pillStyle = {
    backgroundColor: surface ? surface.panel : colors.brand50,
    borderColor: surface ? surface.border : colors.brand100,
  };
  const textColor = surface ? surface.muted : colors.ink500;
  return (
    <View style={styles.footerBlock}>
      <View style={styles.footerLegalRow}>
        <Pressable accessibilityRole="button" onPress={onPrivacy} style={({ pressed }) => [styles.footerLegalPill, pillStyle, pressed && styles.pressed]}>
          <Text style={[styles.footerLegalText, { color: textColor }]}>Privacy Policy</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onTerms} style={({ pressed }) => [styles.footerLegalPill, pillStyle, pressed && styles.pressed]}>
          <Text style={[styles.footerLegalText, { color: textColor }]}>Terms &amp; Conditions</Text>
        </Pressable>
      </View>
      <View style={[styles.footerVersionPill, pillStyle]}>
        <Image source={iconSrc} style={styles.footerVersionMark} resizeMode="contain" alt="" />
        <Text style={[styles.footerLegalText, { color: textColor }]}>{version}</Text>
      </View>
      <Text style={styles.footerCaption}>{caption}</Text>
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Pressable
          key={option}
          accessibilityRole="tab"
          {...tabState(option === value)}
          onPress={() => onChange(option)}
          style={({ pressed }) => [styles.segment, pressed && styles.pressed]}
        >
          <Text style={[styles.segmentText, option === value && styles.segmentTextActive]}>{option}</Text>
          {option === value ? <View style={styles.segmentIndicator} /> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  screenDeep: { backgroundColor: colors.brand900 },
  screenContent: { paddingHorizontal: spacing.lg, paddingBottom: 138, gap: spacing.md },
  staticScreen: { flex: 1, backgroundColor: colors.surface },
  title: { color: colors.ink900, fontFamily: fonts.display, fontSize: 38, lineHeight: 42 },
  titleDeep: { color: colors.white },
  sectionTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 24, lineHeight: 30, marginTop: spacing.md },
  sectionTitleDeep: { color: colors.white },
  body: { color: colors.ink700, fontFamily: fonts.sans, fontSize: 15, lineHeight: 22 },
  bodyDeep: { color: colors.brand200 },
  muted: { color: colors.ink500 },
  mutedDeep: { color: colors.brand300 },
  eyebrow: { color: colors.brand600, fontFamily: fonts.sansBold, fontSize: 12, letterSpacing: 1.3, textTransform: 'uppercase' },
  eyebrowDeep: { color: colors.brand300 },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.brand100, padding: spacing.lg, ...shadow.card },
  cardDeep: { backgroundColor: colors.brand800, borderColor: colors.brand700 },
  button: { minHeight: 56, borderRadius: radius.pill, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink900 },
  // Mirrors the web drawer: the filled action is brand-600, and "Exit to
  // Website" is an outline on the plum rather than a white pill.
  buttonDeep: { backgroundColor: colors.brand600 },
  secondaryButton: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.ink900 },
  secondaryButtonDeep: { backgroundColor: 'transparent', borderColor: colors.brand700 },
  softButton: { backgroundColor: colors.brand100 },
  softButtonDeep: { backgroundColor: colors.brand800 },
  buttonText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 16 },
  secondaryButtonText: { color: colors.ink900 },
  secondaryButtonTextDeep: { color: colors.brand200 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
  pillRow: { minHeight: 78, borderRadius: radius.pill, backgroundColor: colors.brand50, borderWidth: 1, borderColor: colors.brand100, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  pillRowDeep: { backgroundColor: colors.brand800, borderColor: colors.brand700 },
  rowCopy: { flex: 1, gap: 3 },
  rowImage: { width: 24, height: 24 },
  footerBlock: { gap: spacing.sm, marginTop: spacing.md },
  footerLegalRow: { flexDirection: 'row', gap: spacing.sm },
  footerLegalPill: { flex: 1, minHeight: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  footerLegalText: { fontFamily: fonts.sansMedium, fontSize: 14 },
  footerVersionPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, borderRadius: radius.pill, paddingHorizontal: spacing.lg, borderWidth: 1 },
  footerVersionMark: { width: 18, height: 18 },
  footerCaption: { color: colors.ink400, fontFamily: fonts.sans, fontSize: 11, paddingHorizontal: 4 },
  rowTitle: { color: colors.ink900, fontFamily: fonts.sansBold, fontSize: 16 },
  rowTitleDeep: { color: colors.white },
  rowSubtitle: { color: colors.ink500, fontFamily: fonts.sans, fontSize: 12 },
  rowSubtitleDeep: { color: colors.brand300 },
  segmented: { flexDirection: 'row', marginHorizontal: -spacing.lg, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.ink200, backgroundColor: colors.white },
  segment: { flex: 1, alignItems: 'center', paddingTop: spacing.md, minHeight: 58, justifyContent: 'space-between' },
  segmentText: { color: colors.ink700, fontFamily: fonts.sans, fontSize: 15 },
  segmentTextActive: { color: colors.ink900, fontFamily: fonts.sansBold },
  segmentIndicator: { width: '72%', height: 4, borderRadius: radius.pill, backgroundColor: colors.ink900 },
  stateWrap: { flex: 1, padding: spacing.xl, justifyContent: 'center', gap: spacing.md },
  stateMark: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brand100 },
  stateMarkText: { color: colors.brand700, fontFamily: fonts.display, fontSize: 22 },
});
