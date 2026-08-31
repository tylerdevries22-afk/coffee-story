import {
  createAnalyticsSurfaceObserver, createAnalyticsTransport, screenKeyFor,
  tenantIdHintFromJwt,
} from '@platform/analytics';
import Constants from 'expo-constants';
import { usePathname } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/state/auth-context';

const SCREENS: Readonly<Record<string, string>> = {
  '/': 'entry', '/client': 'customer_shell', '/client/home': 'home',
  '/client/book': 'order', '/client/gift': 'gift', '/client/rewards': 'rewards',
  '/client/more': 'more', '/client/more/catering': 'catering',
  '/client/more/drops': 'drops', '/client/more/faq': 'faq',
  '/client/more/gift-balance': 'gift_balance', '/client/more/location': 'location',
  '/client/more/membership': 'membership', '/client/more/menu-prices': 'menu_prices',
  '/client/more/messages': 'messages', '/client/more/order-policy': 'order_policy',
  '/client/more/orders': 'orders', '/client/more/payments': 'payments',
  '/client/more/preferences': 'preferences', '/client/more/privacy': 'privacy',
  '/client/more/profile': 'profile', '/client/more/referrals': 'referrals',
  '/client/more/resources': 'resources', '/drops/:id': 'drop_detail',
  '/notifications': 'notifications', '/refer/:code': 'referral_landing',
};

function route(pathname: string): string {
  if (pathname.startsWith('/drops/')) return '/drops/:id';
  if (pathname.startsWith('/refer/')) return '/refer/:code';
  return pathname;
}

/** Behavioral screen events stay suppressed until the customer opts in. */
export function CustomerTelemetry() {
  const pathname = usePathname();
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const brandId = accessToken ? tenantIdHintFromJwt(accessToken) : null;
  const behavioral = session?.user.user_metadata?.analytics_consent === true;
  const consentUpdatedAt = useRef(new Date().toISOString());
  const endpoint = useMemo(() => {
    try {
      return process.env.EXPO_PUBLIC_API_URL
        ? new URL('/api/analytics/events', process.env.EXPO_PUBLIC_API_URL).toString() : null;
    } catch { return null; }
  }, []);
  const transport = useMemo(() => {
    try {
      return endpoint
        ? createAnalyticsTransport({ endpoint, getAccessToken: async () => accessToken }) : null;
    } catch { return null; }
  }, [accessToken, endpoint]);
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
    observer.observe({
      sessionIdentity: `${session.user.id}:${behavioral ? 'allowed' : 'essential'}`,
      screenKey: screenKeyFor(route(pathname), SCREENS),
      context: {
        brandId, surface: 'customer', appVersion: Constants.expoConfig?.version ?? 'unknown',
        consent: {
          essential: true, behavioral, source: 'user', updatedAt: consentUpdatedAt.current,
        },
      },
    });
  }, [behavioral, brandId, observer, pathname, session]);
  return null;
}
