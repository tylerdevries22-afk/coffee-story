import { Fraunces_700Bold } from '@expo-google-fonts/fraunces/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { fontGateReady } from '@/lib/font-gate';
import { initMobileMonitoring } from '@platform/monitoring';
import { liveConfigFromEnv, missingLiveConfig, type MobileLiveConfig } from '@/lib/runtime-config';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppErrorBoundary } from '@/components/app-error-boundary';
import { Button } from '@/components/ui';
import { InstallPrompt } from '@/components/install-prompt';
import { brandCache } from '@/lib/brand-cache';
import { AppStateProvider } from '@/state/app-context';
import { AuthProvider } from '@/state/auth-context';
import { DemoProvider, useDemo } from '@/state/demo-context';
import { OrderProvider } from '@/state/order-context';
import { TENANT_BRAND_CONFIG } from '@/tenant';
import {
  ThemeProvider,
  ToastProvider,
  useTokens,
  useTokens as useBrandTokens,
} from '@platform/ui';

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
    /* Rule 4: tokens + copy hydrate from the tenant's brand config; the
       cache keeps a cold offline start branded. */
    <ThemeProvider brandConfig={TENANT_BRAND_CONFIG} storage={brandCache}>
      <ToastProvider>
        <AppErrorBoundary>
          <DemoProvider synchronizeOrders>
            <ConfiguredApp config={config} />
          </DemoProvider>
        </AppErrorBoundary>
      </ToastProvider>
    </ThemeProvider>
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
      <AppStateProvider>
        {/* The bag sits above the tab shell so a guest can leave the Order tab
            mid-order -- to check their rewards balance, say -- and come back to
            a bag that is still there. */}
        <OrderProvider>
          <StatusBar style="dark" />
          <CustomerStack />
          {/* Global chrome that used to live in `app/index.tsx` when it was the
              entire app. It sits above the Stack so it survives navigating into
              `/client` or `/staff` instead of unmounting the moment the
              redirect fires. */}
          <InstallPrompt />
        </OrderProvider>
      </AppStateProvider>
    </AuthProvider>
  );
}

function CustomerStack() {
  // The page ground and every screen token resolve from the tenant provider,
  // so a second tenant does not inherit a compiled palette.
  const tokens = useTokens();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: tokens.surface } }}>
      {/* Pushed from any tab in either shell (see app-context's
          `openNotifications`) rather than nested under `client/` or
          `staff/`: a route at this level pushes above the native tab bar
          from wherever the user is, which a screen nested inside a
          specific tab's own stack could not do. `slide_from_right` keeps
          the direction the app used before this was a real route. */}
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
        This build is missing the account or ordering configuration live mode needs. You can still
        explore the whole app in Demo.
      </Text>
      <Text accessibilityRole="text" style={{ color: tokens.textMuted, fontSize: 12 }}>
        Missing: {missing.join(', ')}
      </Text>
      <Button label="Continue in Demo" onPress={onUseDemo} />
    </View>
  );
}
