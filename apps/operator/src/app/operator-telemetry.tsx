import {
  createAnalyticsSurfaceObserver,
  createAnalyticsTransport,
  screenKeyFor,
} from '@platform/analytics';
import { analyticsQueueStore } from '@platform/expo-storage';
import Constants from 'expo-constants';
import { usePathname } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/state/auth-context';

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
export function OperatorTelemetry() {
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
  // Brand-keyed so a tablet that signs into a second tenant starts clean.
  const store = useMemo(() => brandId ? analyticsQueueStore(brandId) : undefined, [brandId]);
  const transport = useMemo(() => {
    if (!endpoint) return null;
    try {
      return createAnalyticsTransport({ endpoint, getAccessToken: async () => accessToken, store });
    } catch {
      return null;
    }
  }, [accessToken, endpoint, store]);
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
