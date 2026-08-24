import { Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

import { ThemeProvider } from '@platform/ui';

import TENANT_BRAND_CONFIG from '@/tenant/brand.json';

import { IdleNotice } from '@/components/idle-notice';
import { menuFactsFromCatalog } from '@/data/menu-source';
import { DeviceProvider } from '@/state/device';
import { FlowProvider, useFlow } from '@/state/flow';
import { KioskSessionProvider } from '@/state/session';

/** Stable identity: rebuilding this each render would re-resolve the flow. */
const MENU_FACTS = menuFactsFromCatalog();
const SPLASH_GROUND = TENANT_BRAND_CONFIG.tokens?.surface ?? '#FAFAF9';

export default function KioskLayout() {
  const [loaded] = useFonts({
    Inter_400Regular, Inter_600SemiBold, Inter_700Bold, Fraunces_700Bold,
  });

  // A kiosk is bolted to a stand. Locking the orientation means a guest cannot
  // turn the layout into a phone-shaped one by leaning on it, and it is the
  // whole reason the bag can be a permanent rail rather than a screen.
  //
  // Native only. A desktop browser rejects screen.orientation.lock() from
  // inside the module, where a .catch() on the returned promise never sees it,
  // so every boot of the web export logged an unhandled rejection -- noise that
  // hides a real one. The web export is a review surface, not the target.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
      .catch(() => undefined);
  }, []);

  // The splash ground is the tenant's, read before the theme mounts. Rule 4
  // has no exception for a loading state -- a shop whose kiosk flashes another
  // brand's cream for a beat has been unbranded for that beat.
  if (!loaded) return <View style={{ flex: 1, backgroundColor: SPLASH_GROUND }} />;

  return (
    <ThemeProvider brandConfig={TENANT_BRAND_CONFIG}>
      <DeviceProvider>
        {/*
          FlowProvider sits ABOVE the session on purpose: the session's idle
          clock is tenant-configured (`brand_config.kiosk.idle`), so the flow
          has to be resolved before the thing that consumes it is constructed.
          With the session on the outside it silently fell back to the platform
          defaults, and a container tenant's longer window -- the whole reason
          the field exists -- never took effect.
        */}
        <FlowProvider
          brandConfig={TENANT_BRAND_CONFIG.kiosk}
          menu={MENU_FACTS}
          storedValue={TENANT_BRAND_CONFIG.features?.stored_value === true}
        >
          <KioskSurface />
        </FlowProvider>
      </DeviceProvider>
    </ThemeProvider>
  );
}

/** Inside FlowProvider, so the session can be built from the resolved flow. */
function KioskSurface() {
  const { flow } = useFlow();
  return (
    <KioskSessionProvider timing={flow.idle}>
      <StatusBar hidden />
      {/* The step transition is ours (see step-stage.tsx), so the stack must
          not add one of its own on top of it. */}
      <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      {/* Mounted once, at the root: the notice used to live only on the order
          screen, which is why an abandoned session at tender had its cart
          cleared under a live Pay button. */}
      <IdleNotice />
    </KioskSessionProvider>
  );
}
