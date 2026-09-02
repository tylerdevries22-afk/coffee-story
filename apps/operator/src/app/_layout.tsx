import { Fraunces_700Bold } from '@expo-google-fonts/fraunces/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { fontGateReady } from '@platform/domain';
import { initMobileMonitoring } from '@platform/monitoring';
import {
  createAnalyticsSurfaceObserver,
  createAnalyticsTransport,
  screenKeyFor,
} from '@platform/analytics';
import { liveConfigFromEnv, missingLiveConfig, type MobileLiveConfig } from '@/lib/runtime-config';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, type PropsWithChildren } from 'react';
import { AppState, Platform, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { Button } from '@/components/ui';
import { InstallPrompt } from '@/components/install-prompt';
import { OperatorDevicePresence } from '@/features/device-wall/operator-presence';
import { brandCache } from '@/lib/brand-cache';
import { useOperationNotificationObserver } from '@/features/operations/push';
import { AppStateProvider } from '@/state/app-context';
import { AuthProvider, useAuth } from '@/state/auth-context';
import { DemoProvider, useDemo } from '@/state/demo-context';
import { ThemeProvider, useTokens, useTokens as useBrandTokens } from '@platform/ui';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

void initMobileMonitoring();

export default function RootLayout() {
  const [loaded, fontError] = useFonts({ Inter_400Regular, Inter_600SemiBold, Inter_700Bold, Fraunces_700Bold });

  // A font failure must not strand the app on the held splash — see
  // `fontGateReady` for why `loaded` alone is not a safe gate.
  const ready = fontGateReady(loaded, fontError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  useEffect(() => {
    if (!fontError) return;
    console.warn('Brand fonts failed to load; falling back to system fonts.', {
      errorName: fontError.name,
      errorMessage: fontError.message.replaceAll(/\s+/g, ' ').slice(0, 240),
    });
  }, [fontError]);

  // Native holds the splash until the brand fonts are ready, so the first frame
  // is never a flash of system text. The web build must not: `useFonts` does not
  // settle in the browser, which left the whole app rendering null forever, and
  // a web font swap is the normal, expected behaviour there anyway.
  if (!ready && Platform.OS !== 'web') return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RuntimeProviders />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RuntimeProviders() {
  // Read through `liveConfigFromEnv` so this and `hasCompleteLiveConfig` --
  // which decides whether live mode is even offered -- cannot disagree about
  // what this build carries.
  const config: MobileLiveConfig = liveConfigFromEnv();

  return (
    <AppErrorBoundary>
      <DemoProvider>
        <ConfiguredApp config={config} />
      </DemoProvider>
    </AppErrorBoundary>
  );
}

function ConfiguredApp({ config }: { config: MobileLiveConfig }) {
  const { chooseDemo, mode } = useDemo();
  const missing = missingLiveConfig(config);
  if (mode === 'live' && missing.length > 0) {
    return <RuntimeConfigError missing={missing} onUseDemo={() => void chooseDemo()} />;
  }

  return (
    <AuthProvider>
      <BrandedShell>
        <AppStateProvider>
          <StatusBar style="dark" />
          <OperatorStack />
          {/* Sits above the Stack so it survives navigating into `/staff` instead
              of unmounting the moment the redirect fires. */}
          <InstallPrompt />
        </AppStateProvider>
      </BrandedShell>
    </AuthProvider>
  );
}

/**
 * Rule 4, the operator half: tokens and copy hydrate from the tenant's brand
 * config instead of a compiled-in palette.
 *
 * Inside `AuthProvider`, unlike the customer app, because the two binaries
 * learn who the tenant is in different ways (rule 7). The guest binary is
 * built for one brand, so its config is bundled and its provider can sit at
 * the root. This one is a single listing serving every tenant, so the brand
 * row only arrives with the session -- there is nothing to theme from until
 * someone signs in. `brandCache` covers the gap: the last good config opens
 * the app branded before the network answers, which for a staff device on a
 * shop's patchy wifi is the normal case rather than the edge one.
 */
function BrandedShell({ children }: PropsWithChildren) {
  const { brandConfig } = useAuth();
  return (
    <ThemeProvider brandConfig={brandConfig} storage={brandCache}>
      <OperatorTelemetry />
      <OperatorDevicePresence />
      {children}
    </ThemeProvider>
  );
}

const OPERATOR_SCREENS: Readonly<Record<string, string>> = {
  '/': 'entry',
  '/notifications': 'notifications',
  '/staff': 'operator_shell',
  '/staff/calendar': 'calendar',
  '/staff/calendar/:id': 'calendar_item',
  '/staff/crew': 'crew',
  '/staff/crew/:occurrence': 'operation_detail',
  '/staff/more': 'more',
  '/staff/more/:path': 'management_detail',
  '/staff/orders': 'orders',
  '/staff/prep': 'prep',
  '/staff/training': 'training',
  '/staff/training/:module': 'training_module',
  '/staff/training/:module/:lesson': 'training_lesson',
};

function operatorRoute(pathname: string): string {
  if (pathname.startsWith('/staff/calendar/')) return '/staff/calendar/:id';
  if (pathname.startsWith('/staff/crew/')) return '/staff/crew/:occurrence';
  if (pathname.startsWith('/staff/more/')) return '/staff/more/:path';
  if (pathname.startsWith('/staff/training/')) {
    const depth = pathname.split('/').filter(Boolean).length;
    return depth >= 4 ? '/staff/training/:module/:lesson' : '/staff/training/:module';
  }
  return pathname;
}

function operatorAnalyticsPolicy(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const privacy = (value as { privacy?: unknown }).privacy;
  return Boolean(privacy && typeof privacy === 'object'
    && !Array.isArray(privacy)
    && (privacy as { analyticsBehavioral?: unknown }).analyticsBehavioral === true);
}

/** Staff journeys require both tenant policy and an explicit account opt-in. */
function OperatorTelemetry() {
  const pathname = usePathname();
  const { brandConfig, session, tenant } = useAuth();
  const accessToken = session?.access_token ?? null;
  const brandId = tenant?.brand_id ?? null;
  const behavioralConsent = operatorAnalyticsPolicy(brandConfig)
    && session?.user.user_metadata?.analytics_consent === true;
  const consentUpdatedAt = useRef(new Date().toISOString());
  const endpoint = useMemo(() => {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!baseUrl) return null;
    try { return new URL('/api/analytics/events', baseUrl).toString(); }
    catch { return null; }
  }, []);
  const transport = useMemo(() => {
    if (!endpoint) return null;
    try {
      return createAnalyticsTransport({ endpoint, getAccessToken: async () => accessToken });
    } catch {
      return null;
    }
  }, [accessToken, endpoint]);
  const observer = useMemo(() => transport ? createAnalyticsSurfaceObserver(transport) : null, [transport]);

  useEffect(() => () => transport?.dispose(), [transport]);
  useEffect(() => {
    if (!transport) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void transport.flush();
    });
    return () => subscription.remove();
  }, [transport]);
  useEffect(() => {
    if (!observer || !session || !brandId) return;
    const consentKey = `${session.user.id}:${behavioralConsent ? 'allowed' : 'essential'}`;
    const screenKey = screenKeyFor(operatorRoute(pathname), OPERATOR_SCREENS);
    observer.observe({
      sessionIdentity: consentKey,
      screenKey,
      context: {
        brandId,
        surface: 'operator',
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        consent: {
          essential: true,
          behavioral: behavioralConsent,
          source: 'user',
          updatedAt: consentUpdatedAt.current,
        },
      },
    });
  }, [behavioralConsent, brandId, observer, pathname, session]);
  return null;
}

function OperatorStack() {
  useOperationNotificationObserver();
  // The page ground and every screen token resolve from the signed-in tenant.
  const tokens = useTokens();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: tokens.surface } }}>
      {/* Pushed from any tab (see app-context's `openNotifications`) rather
          than nested under `staff/`: a route at this level pushes above the
          native tab bar from wherever the user is, which a screen nested
          inside a specific tab's own stack could not do. `slide_from_right`
          keeps the direction the app used before this was a real route. */}
      <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}

/**
 * The dead end this used to be is the reason `onUseDemo` exists.
 *
 * Live mode is persisted, so a build that reached this screen opened on it
 * again on every launch, and the only control that could have changed the mode
 * lives on a More page this screen replaces. Following the README's own
 * `cp .env.example .env` produced exactly that: its Supabase placeholders
 * validate and its Stripe placeholder does not.
 */
function RuntimeConfigError({ missing, onUseDemo }: { missing: string[]; onUseDemo: () => void }) {
  const tokens = useBrandTokens();
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 32, gap: 16, backgroundColor: tokens.surface }}>
      <Text style={{ color: tokens.textPrimary, fontSize: 24, fontWeight: '700' }}>
        Secure setup is incomplete
      </Text>
      <Text style={{ color: tokens.textMuted, fontSize: 16, lineHeight: 24 }}>
        This build is missing the payment or account configuration live mode needs. You can still
        explore the whole app in Demo.
      </Text>
      <Text accessibilityRole="text" style={{ color: tokens.textMuted, fontSize: 12 }}>
        Missing: {missing.join(', ')}
      </Text>
      <Button label="Continue in Demo" onPress={onUseDemo} />
    </View>
  );
}
