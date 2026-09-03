import {
  createAnalyticsSurfaceObserver, createAnalyticsTransport, screenKeyFor,
} from '@platform/analytics';
import { analyticsQueueStore } from '@platform/expo-storage';
import Constants from 'expo-constants';
import { usePathname } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { useDevice } from '@/state/device';
import { useKioskSession } from '@/state/session';
import TENANT from '@/tenant/brand.json';

const SCREENS: Readonly<Record<string, string>> = {
  '/': 'entry', '/pair': 'device_pairing', '/bag': 'bag',
  '/checkout/balance': 'balance', '/checkout/identify': 'identify',
  '/checkout/keypad': 'keypad', '/checkout/name': 'guest_name',
  '/checkout/pay': 'payment', '/checkout/processing': 'payment_processing',
  '/checkout/tip': 'tip', '/done': 'confirmation', '/order/entry': 'order_entry',
  '/order/fill': 'order_fill', '/order/item': 'item_detail',
  '/order/node': 'order_category', '/order/options': 'item_options',
  '/order/pack': 'pack_builder', '/order/review': 'order_review',
};

function behavioralPolicy(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const privacy = (value as { privacy?: unknown }).privacy;
  return Boolean(privacy && typeof privacy === 'object' && !Array.isArray(privacy)
    && (privacy as { analyticsBehavioral?: unknown }).analyticsBehavioral === true);
}

/** Kiosk behavioral journeys require an explicit tenant privacy policy. */
export function KioskTelemetry() {
  const pathname = usePathname();
  const device = useDevice();
  const { resetSeq } = useKioskSession();
  const behavioral = behavioralPolicy(TENANT);
  const consentUpdatedAt = useRef(new Date().toISOString());
  const endpoint = useMemo(() => {
    try {
      return process.env.EXPO_PUBLIC_API_URL
        ? new URL('/api/analytics/events', process.env.EXPO_PUBLIC_API_URL).toString() : null;
    } catch { return null; }
  }, []);
  // Brand-keyed so a tablet re-paired to a second tenant starts clean. Without
  // a store the queue is lost on every app kill, which on a counter tablet that
  // is force-quit at close is most of a day's journeys.
  const store = useMemo(
    () => device.brandId ? analyticsQueueStore(device.brandId) : undefined,
    [device.brandId],
  );
  const transport = useMemo(() => {
    try {
      return endpoint ? createAnalyticsTransport({
        endpoint, getAccessToken: async () => device.accessToken, store,
      }) : null;
    } catch { return null; }
  }, [device.accessToken, endpoint, store]);
  const observer = useMemo(
    () => transport ? createAnalyticsSurfaceObserver(transport) : null,
    [transport],
  );

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
    observer.observe({
      sessionIdentity: `${device.deviceId}:${resetSeq}:${behavioral ? 'allowed' : 'essential'}`,
      screenKey: screenKeyFor(pathname, SCREENS),
      context: {
        brandId: device.brandId, locationId: device.locationId, surface: 'kiosk',
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        consent: {
          essential: true, behavioral, source: 'tenant_policy', updatedAt: consentUpdatedAt.current,
        },
      },
    });
  }, [behavioral, device, observer, pathname, resetSeq]);
  return null;
}
