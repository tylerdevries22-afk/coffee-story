import { createContext, useContext, useMemo, type PropsWithChildren, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator, Animated, Image, Platform, Pressable, ScrollView, Text, View,
  type ImageSourcePropType, type PressableProps, type ScrollViewProps, type StyleProp,
  type TextStyle, type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabState } from './a11y-state';
import { useTokens } from './theme';
import type { BrandTokens } from './tokens';

export type SurfaceTone = 'light' | 'deep' | 'admin' | 'staff';
const ToneContext = createContext<SurfaceTone>('light');

export function useSurfaceTone(): SurfaceTone { return useContext(ToneContext); }

type ToneSurface = { screen: string; panel: string; border: string; body: string; muted: string; onDark: boolean };

function toneSurface(tokens: BrandTokens, tone: SurfaceTone): ToneSurface | null {
  if (tone === 'light') return null;
  if (tone === 'deep') return {
    screen: tokens.primary, panel: tokens.secondary, border: tokens.textMuted,
    body: tokens.surface, muted: tokens.surfaceElevated, onDark: true,
  };
  return {
    screen: tokens.surface, panel: tokens.surfaceElevated, border: tokens.secondary,
    body: tokens.textPrimary, muted: tokens.textMuted, onDark: false,
  };
}

export function useOnDarkSurface(): boolean {
  const tokens = useTokens();
  return toneSurface(tokens, useSurfaceTone())?.onDark ?? false;
}

export function AppScreen({ children, tone = 'light', scrollY, scrollRef, ...props }: PropsWithChildren<ScrollViewProps & {
  tone?: SurfaceTone; scrollY?: Animated.Value; scrollRef?: Ref<ScrollView>;
}>) {
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const surface = toneSurface(tokens, tone);
  const Scroller = scrollY ? Animated.ScrollView : ScrollView;
  const { onScroll } = props;
  const handleScroll = useMemo(() => scrollY
    ? Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: Platform.OS !== 'web', listener: onScroll })
    : onScroll, [onScroll, scrollY]);
  return (
    <ToneContext.Provider value={tone}>
      <Scroller {...props} ref={scrollRef} onScroll={handleScroll}
        style={[{ flex: 1, backgroundColor: surface?.screen ?? tokens.surface }, props.style]}
        contentContainerStyle={[{
          paddingHorizontal: tokens.spacing.lg, paddingBottom: 138,
          paddingTop: insets.top + tokens.spacing.lg, gap: tokens.spacing.md,
        }, props.contentContainerStyle]}
        showsVerticalScrollIndicator={false}>
        {children}
      </Scroller>
    </ToneContext.Provider>
  );
}

export function AppStaticScreen({ children }: PropsWithChildren) {
  const tokens = useTokens();
  return <SafeAreaView style={{ flex: 1, backgroundColor: tokens.surface }}>{children}</SafeAreaView>;
}

export function AppTitle({ children, style }: PropsWithChildren<{ style?: StyleProp<TextStyle> }>) {
  const tokens = useTokens();
  const deep = useOnDarkSurface();
  return <Text style={[{ color: deep ? tokens.surfaceElevated : tokens.textPrimary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.display, lineHeight: tokens.type.display + tokens.spacing.xs }, style]}>{children}</Text>;
}

export function AppSectionTitle({ children }: PropsWithChildren) {
  const tokens = useTokens();
  const deep = useOnDarkSurface();
  return <Text style={{ color: deep ? tokens.surfaceElevated : tokens.textPrimary, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.xl, lineHeight: tokens.type.xxl, marginTop: tokens.spacing.md }}>{children}</Text>;
}

export function AppBody({ children, muted = false }: PropsWithChildren<{ muted?: boolean }>) {
  const tokens = useTokens();
  const surface = toneSurface(tokens, useSurfaceTone());
  return <Text style={{ color: surface ? (muted ? surface.muted : surface.body) : (muted ? tokens.textMuted : tokens.textPrimary), fontFamily: tokens.fontBody, fontSize: tokens.type.md, lineHeight: tokens.type.xl }}>{children}</Text>;
}

export function AppEyebrow({ children }: PropsWithChildren) {
  const tokens = useTokens();
  const surface = toneSurface(tokens, useSurfaceTone());
  return <Text style={{ color: surface?.muted ?? tokens.primary, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.xs, letterSpacing: 1.3, textTransform: 'uppercase' }}>{children}</Text>;
}

export function AppCard({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const tokens = useTokens();
  const surface = toneSurface(tokens, useSurfaceTone());
  return <View style={[{
    backgroundColor: surface?.panel ?? tokens.surfaceElevated,
    borderRadius: tokens.radius.lg, borderWidth: 1,
    borderColor: surface?.border ?? tokens.secondary, padding: tokens.spacing.lg,
    shadowColor: tokens.textPrimary, shadowOpacity: tokens.elevation.card,
    shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  }, style]}>{children}</View>;
}

export type AppButtonProps = Omit<PressableProps, 'onPress'> & {
  label: string; variant?: 'primary' | 'secondary' | 'soft'; loading?: boolean;
  onPress: NonNullable<PressableProps['onPress']>;
};

export function AppButton({ label, variant = 'primary', loading, disabled, style, ...props }: AppButtonProps) {
  const tokens = useTokens();
  const surface = toneSurface(tokens, useSurfaceTone());
  const deep = surface?.onDark ?? false;
  const primary = deep ? tokens.secondary : tokens.textPrimary;
  const background = variant === 'primary' ? primary : variant === 'soft' ? (surface?.panel ?? tokens.surface) : 'transparent';
  const ink = variant === 'primary' ? tokens.surfaceElevated : (surface?.body ?? tokens.textPrimary);
  return <Pressable accessibilityRole="button" disabled={disabled || loading} {...props} style={(state) => [{
    minHeight: 56, borderRadius: tokens.radius.pill, paddingHorizontal: tokens.spacing.xl,
    alignItems: 'center', justifyContent: 'center', backgroundColor: background,
    borderWidth: variant === 'secondary' ? 1.5 : 0,
    borderColor: surface?.border ?? tokens.textPrimary,
    opacity: disabled || loading ? 0.45 : state.pressed ? 0.72 : 1,
    transform: [{ scale: state.pressed ? 0.99 : 1 }],
  }, typeof style === 'function' ? style(state) : style]}>
    {loading ? <ActivityIndicator color={tokens.surfaceElevated} /> : <Text style={{ color: ink, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.md }}>{label}</Text>}
  </Pressable>;
}

export function AppPillRow({ title, subtitle, icon, value, onPress }: {
  title: string; subtitle?: string; icon?: ReactNode; value?: ReactNode; onPress?: () => void;
}) {
  const tokens = useTokens();
  const surface = toneSurface(tokens, useSurfaceTone());
  const content = <>{icon}<View style={{ flex: 1, gap: 3 }}>
    <Text style={{ color: surface?.onDark ? tokens.surfaceElevated : tokens.textPrimary, fontFamily: tokens.fontBody, fontWeight: '700', fontSize: tokens.type.md }}>{title}</Text>
    {subtitle ? <Text style={{ color: surface?.muted ?? tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xs }}>{subtitle}</Text> : null}
  </View>{value ?? (onPress ? <Text style={{ color: surface?.muted ?? tokens.textMuted, fontSize: tokens.type.lg }}>›</Text> : null)}</>;
  const rowStyle: ViewStyle = {
    minHeight: 78, borderRadius: tokens.radius.pill, backgroundColor: surface?.panel ?? tokens.surface,
    borderWidth: 1, borderColor: surface?.border ?? tokens.secondary, flexDirection: 'row',
    alignItems: 'center', gap: tokens.spacing.md, paddingHorizontal: tokens.spacing.lg,
  };
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [rowStyle, pressed && { opacity: 0.72 }]}>{content}</Pressable> : <View style={rowStyle}>{content}</View>;
}

export function AppMoreFooter({ onPrivacy, onTerms, version, caption, iconSrc }: {
  onPrivacy: () => void; onTerms: () => void; version: string; caption: string; iconSrc: ImageSourcePropType;
}) {
  const tokens = useTokens();
  const surface = toneSurface(tokens, useSurfaceTone());
  const pill: ViewStyle = { minHeight: 44, borderRadius: tokens.radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1, backgroundColor: surface?.panel ?? tokens.surface, borderColor: surface?.border ?? tokens.secondary };
  const text = { color: surface?.muted ?? tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.sm } as const;
  return <View style={{ gap: tokens.spacing.sm, marginTop: tokens.spacing.md }}>
    <View style={{ flexDirection: 'row', gap: tokens.spacing.sm }}>
      <Pressable accessibilityRole="button" onPress={onPrivacy} style={({ pressed }) => [pill, { flex: 1 }, pressed && { opacity: 0.72 }]}><Text style={text}>Privacy Policy</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onTerms} style={({ pressed }) => [pill, { flex: 1 }, pressed && { opacity: 0.72 }]}><Text style={text}>Terms &amp; Conditions</Text></Pressable>
    </View>
    <View style={[pill, { alignSelf: 'flex-start', flexDirection: 'row', gap: tokens.spacing.sm, paddingHorizontal: tokens.spacing.lg }]}>
      <Image source={iconSrc} style={{ width: 18, height: 18 }} resizeMode="contain" alt="" /><Text style={text}>{version}</Text>
    </View>
    <Text style={{ color: tokens.textMuted, fontFamily: tokens.fontBody, fontSize: tokens.type.xs, paddingHorizontal: tokens.spacing.xs }}>{caption}</Text>
  </View>;
}

export function AppSegmented<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T; onChange: (next: T) => void }) {
  const tokens = useTokens();
  return <View style={{ flexDirection: 'row', marginHorizontal: -tokens.spacing.lg, paddingHorizontal: tokens.spacing.md, borderBottomWidth: 1, borderBottomColor: tokens.secondary, backgroundColor: tokens.surfaceElevated }}>
    {options.map((option) => <Pressable key={option} accessibilityRole="tab" {...tabState(option === value)} onPress={() => onChange(option)} style={({ pressed }) => ({ flex: 1, alignItems: 'center', paddingTop: tokens.spacing.md, minHeight: 58, justifyContent: 'space-between', opacity: pressed ? 0.72 : 1 })}>
      <Text style={{ color: option === value ? tokens.textPrimary : tokens.textMuted, fontFamily: tokens.fontBody, fontWeight: option === value ? '700' : '400', fontSize: tokens.type.md }}>{option}</Text>
      {option === value ? <View style={{ width: '72%', height: tokens.spacing.xs, borderRadius: tokens.radius.pill, backgroundColor: tokens.textPrimary }} /> : null}
    </Pressable>)}
  </View>;
}

export function AppLoadingState({ label }: { label: string }) {
  const tokens = useTokens();
  return <AppStaticScreen><View style={{ flex: 1, padding: tokens.spacing.xl, justifyContent: 'center', gap: tokens.spacing.md }}><ActivityIndicator color={tokens.primary} /><AppTitle>One moment.</AppTitle><AppBody muted>{label}</AppBody></View></AppStaticScreen>;
}

export function AppErrorState({ title = 'Something went quiet.', message, onRetry, mark = '!' }: { title?: string; message: string; onRetry?: () => void; mark?: string }) {
  const tokens = useTokens();
  return <AppStaticScreen><View style={{ flex: 1, padding: tokens.spacing.xl, justifyContent: 'center', gap: tokens.spacing.md }}><View style={{ width: 64, height: 64, borderRadius: tokens.radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.surfaceElevated }}><Text style={{ color: tokens.primary, fontFamily: tokens.fontDisplay, fontSize: tokens.type.xl }}>{mark}</Text></View><AppTitle>{title}</AppTitle><AppBody muted>{message}</AppBody>{onRetry ? <AppButton label="Try again" onPress={onRetry} /> : null}</View></AppStaticScreen>;
}
