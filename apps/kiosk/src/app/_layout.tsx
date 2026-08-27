import { Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import {
  createAnalyticsSurfaceObserver,
  createAnalyticsTransport,
  screenKeyFor,
} from '@platform/analytics';
import Constants from 'expo-constants';
import { Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef } from 'react';
import { AppState, Platform, View } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

import { DEFAULT_TOKENS, ThemeProvider } from '@platform/ui';
import { initMobileMonitoring } from '@platform/monitoring';

import TENANT_BRAND_CONFIG from '@/tenant/brand.json';

import { menuFactsFrom } from '@platform/domain';

import { IdleNotice } from '@/components/idle-notice';
import { MenuProvider, useKioskMenu } from '@/data/menu-store';
import { DeviceProvider, useDevice } from '@/state/device';
import { BuilderProvider } from '@/state/builder';
import { FlowProvider, useFlow } from '@/state/flow';
import { GuestProvider } from '@/state/guest';
import { KioskSessionProvider, useKioskSession } from '@/state/session';

const SPLASH_GROUND = TENANT_BRAND_CONFIG.tokens?.surface ?? DEFAULT_TOKENS.surface;

void initMobileMonitoring();

export default function KioskLayout() {
  const [loaded] = useFonts({
    Inter_400Regular, Inter_600SemiBold, Inter_700Bold, Fraunces_700Bold,
  });

  // A kiosk is bolted to a stand. Locking the orientation means a guest cannot
  // turn the layout into a phone-shaped one by leaning on it. Payment uses the
  // whole stage while cart review is a bounded overlay, so neither may be
  // collapsed into a phone-shaped navigator column.
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
  const { menu, kioskConfig } = useKioskMenu();
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
        brandConfig={kioskConfig}
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
  const { posture } = useDevice();
  return (
    <KioskSessionProvider timing={flow.idle} idleResets={posture.idleResets}>
      <KioskTelemetry />
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

const KIOSK_SCREENS: Readonly<Record<string, string>> = {
  '/': 'entry',
  '/pair': 'device_pairing',
  '/bag': 'bag',
  '/checkout/balance': 'balance',
  '/checkout/identify': 'identify',
  '/checkout/keypad': 'keypad',
  '/checkout/name': 'guest_name',
  '/checkout/pay': 'payment',
  '/checkout/processing': 'payment_processing',
  '/checkout/tip': 'tip',
  '/done': 'confirmation',
  '/order/entry': 'order_entry',
  '/order/fill': 'order_fill',
  '/order/item': 'item_detail',
  '/order/node': 'order_category',
  '/order/options': 'item_options',
  '/order/pack': 'pack_builder',
  '/order/review': 'order_review',
};

function kioskAnalyticsPolicy(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const privacy = (value as { privacy?: unknown }).privacy;
  return Boolean(privacy && typeof privacy === 'object'
    && !Array.isArray(privacy)
    && (privacy as { analyticsBehavioral?: unknown }).analyticsBehavioral === true);
}

/** A kiosk emits behavioral journeys only under an explicit tenant privacy policy. */
function KioskTelemetry() {
  const pathname = usePathname();
  const device = useDevice();
  const { resetSeq } = useKioskSession();
  const behavioralConsent = kioskAnalyticsPolicy(TENANT_BRAND_CONFIG);
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
      return createAnalyticsTransport({ endpoint, getAccessToken: async () => device.accessToken });
    } catch {
      return null;
    }
  }, [device.accessToken, endpoint]);
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
    if (!observer || device.status !== 'ready' || !device.brandId || !device.locationId) return;
    const owner = `${device.deviceId}:${resetSeq}:${behavioralConsent ? 'allowed' : 'essential'}`;
    const screenKey = screenKeyFor(pathname, KIOSK_SCREENS);
    observer.observe({
      sessionIdentity: owner,
      screenKey,
      context: {
        brandId: device.brandId,
        locationId: device.locationId,
        surface: 'kiosk',
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        consent: {
          essential: true,
          behavioral: behavioralConsent,
          source: 'tenant_policy',
          updatedAt: consentUpdatedAt.current,
        },
      },
    });
  }, [behavioralConsent, device, observer, pathname, resetSeq]);
  return null;
}
