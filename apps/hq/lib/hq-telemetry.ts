import { createHash } from 'node:crypto';

import {
  createAnalyticsId,
  createAnalyticsTransport,
  screenKeyFor,
  track,
  type AnalyticsTransportResult,
} from '@platform/analytics';

const HQ_SCREENS: Readonly<Record<string, string>> = {
  '/': 'dashboard',
  '/analytics': 'analytics_overview',
  '/analytics/apps': 'analytics_apps',
  '/analytics/commerce': 'analytics_commerce',
  '/analytics/growth': 'analytics_growth',
  '/analytics/operations': 'analytics_operations',
  '/analytics/reliability': 'analytics_reliability',
  '/analytics/training': 'analytics_training',
  '/brand': 'brand',
  '/campaigns': 'campaigns',
  '/content': 'content',
  '/catalog': 'content',
  '/customers': 'customers',
  '/drops': 'drops',
  '/fees': 'platform_fees',
  '/integrations': 'integrations_catalog',
  '/integrations/activity': 'integrations_activity',
  '/integrations/connected': 'integrations_connected',
  '/integrations/health': 'integrations_health',
  '/integrations/:provider': 'integration_detail',
  '/kiosk': 'kiosk_content',
  '/locations': 'locations',
  '/menu': 'menu',
  '/onboarding': 'onboarding',
  '/training': 'training',
  '/wall': 'live_wall',
};

type HqTelemetryInput = Readonly<{
  accessToken: string;
  behavioralConsent: boolean;
  brandId: string;
  endpointOrigin: string;
  pathname: string;
}>;

type HqTelemetryDependencies = Readonly<{
  fetcher?: typeof fetch;
  createId?: () => string;
  now?: Date;
}>;

function stableHqRoute(pathname: string): string {
  if (HQ_SCREENS[pathname]) return pathname;
  if (pathname.startsWith('/integrations/')) return '/integrations/:provider';
  return pathname;
}

function serverSessionHash(accessToken: string, now: Date): string {
  const hour = now.toISOString().slice(0, 13);
  return `h1_${createHash('sha256').update(`${hour}:${accessToken}`).digest('base64url')}`;
}

/** Sends an authenticated HQ screen observation after rendering completes. */
export async function recordHqScreen(
  input: HqTelemetryInput,
  dependencies: HqTelemetryDependencies = {},
): Promise<AnalyticsTransportResult | null> {
  if (!input.behavioralConsent) return null;
  let endpoint: string;
  try { endpoint = new URL('/api/analytics/events', input.endpointOrigin).toString(); }
  catch { return null; }
  const now = dependencies.now ?? new Date();
  const transport = createAnalyticsTransport({
    endpoint,
    getAccessToken: async () => input.accessToken,
    ...(dependencies.fetcher ? { fetcher: dependencies.fetcher } : {}),
    ...(dependencies.createId ? { createId: dependencies.createId } : {}),
    flushDelayMs: 60_000,
  });
  const context = {
    brandId: input.brandId,
    surface: 'hq' as const,
    appVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'hq-web',
    sessionHash: serverSessionHash(input.accessToken, now),
    consent: {
      essential: true as const,
      behavioral: true,
      source: 'user' as const,
      updatedAt: now.toISOString(),
    },
  };
  const screenKey = screenKeyFor(stableHqRoute(input.pathname), HQ_SCREENS);
  for (const [eventName, properties] of [
    ['session.started', { entryPoint: screenKey }],
    ['screen.viewed', { screenKey }],
  ] as const) {
    const event = track(context, {
      clientEventId: createAnalyticsId(),
      occurredAt: now.toISOString(),
      eventName,
      properties,
    });
    if (event) transport.enqueue(event);
  }
  try { return await transport.flush(); }
  finally { transport.dispose(); }
}
