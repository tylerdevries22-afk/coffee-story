import { Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo } from 'react';
import { Platform, View } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

import { DEFAULT_TOKENS, ThemeProvider } from '@platform/ui';

import TENANT_BRAND_CONFIG from '@/tenant/brand.json';

import { menuFactsFrom } from '@platform/domain';

import { IdleNotice } from '@/components/idle-notice';
import { MenuProvider, useKioskMenu } from '@/data/menu-store';
import { DeviceProvider } from '@/state/device';
import { BuilderProvider } from '@/state/builder';
import { FlowProvider, useFlow } from '@/state/flow';
import { GuestProvider } from '@/state/guest';
import { KioskSessionProvider } from '@/state/session';

const SPLASH_GROUND = TENANT_BRAND_CONFIG.tokens?.surface ?? DEFAULT_TOKENS.surface;

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
        <MenuProvider>
          <FlowGate />
        </MenuProvider>
      </DeviceProvider>
    </ThemeProvider>
  );
}

/**
 * The flow, resolved against the menu that is actually loaded.
 *
 * The entry constellation can be derived from the tenant's own categories, so
 * the resolver needs the menu — and the menu now arrives asynchronously and
 * changes under a running screen. Holding it as a module constant read the
 * bundled catalog once at import and never again, which is precisely what
 * made a rebuild the only way to change a tenant's menu.
 */
function FlowGate() {
  const { menu } = useKioskMenu();
  // Recomputed only when the menu itself changes: a new object every render
  // would re-resolve the flow, and the resolved flow is what the idle clock
  // and every screen key off.
  const facts = useMemo(() => menuFactsFrom(menu), [menu]);

  return (
    <>
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
        menu={facts}
        storedValue={TENANT_BRAND_CONFIG.features?.stored_value === true}
      >
        <KioskSurface />
      </FlowProvider>
    </>
  );
}

/** Inside FlowProvider, so the session can be built from the resolved flow. */
function KioskSurface() {
  const { flow } = useFlow();
  return (
    <KioskSessionProvider timing={flow.idle}>
      {/* Innermost, because they are the hot state: every tap on a size, an
          option or a pack choice writes to the builder, and the cart and the
          chrome must not re-render with it. */}
      <GuestProvider>
      <BuilderProvider>
      <StatusBar hidden />
      {/* The step transition is ours (see step-stage.tsx), so the stack must
          not add one of its own on top of it. */}
      <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      {/* Mounted once, at the root: the notice used to live only on the order
          screen, which is why an abandoned session at tender had its cart
          cleared under a live Pay button. */}
      <IdleNotice />
      </BuilderProvider>
      </GuestProvider>
    </KioskSessionProvider>
  );
}
