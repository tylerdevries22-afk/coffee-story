import {
  createAnalyticsId,
  createAnalyticsTransport,
  createSessionHash,
  tenantIdHintFromJwt,
  track,
  type AnalyticsTransportResult,
} from '@platform/analytics';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DisplayTelemetryEnvironment = Readonly<{
  hqOrigin: string | undefined;
  deviceToken: string | undefined;
  appVersion: string;
}>;

type DisplayTelemetryDependencies = Readonly<{
  fetcher?: typeof fetch;
  createId?: () => string;
  environment?: DisplayTelemetryEnvironment;
}>;

function productionEnvironment(): DisplayTelemetryEnvironment {
  return {
    hqOrigin: process.env.HQ_ORIGIN,
    deviceToken: process.env.DISPLAY_DEVICE_TOKEN,
    appVersion: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'display-web',
  };
}

/** Records a display boot after the response is sent, and never breaks the board on failure. */
export async function recordDisplayScreen(
  locationId: string,
  dependencies: DisplayTelemetryDependencies = {},
): Promise<AnalyticsTransportResult | null> {
  const environment = dependencies.environment ?? productionEnvironment();
  if (!UUID.test(locationId) || !environment.hqOrigin || !environment.deviceToken) return null;
  const brandId = tenantIdHintFromJwt(environment.deviceToken);
  if (!brandId) return null;
  let endpoint: string;
  try { endpoint = new URL('/api/analytics/events', environment.hqOrigin).toString(); }
  catch { return null; }

  const transport = createAnalyticsTransport({
    endpoint,
    getAccessToken: async () => environment.deviceToken ?? null,
    ...(dependencies.fetcher ? { fetcher: dependencies.fetcher } : {}),
    ...(dependencies.createId ? { createId: dependencies.createId } : {}),
    flushDelayMs: 60_000,
  });
  const sessionHash = createSessionHash();
  const context = {
    brandId,
    locationId,
    surface: 'display' as const,
    appVersion: environment.appVersion,
    sessionHash,
    consent: {
      essential: true as const,
      behavioral: true,
      source: 'tenant_policy' as const,
      updatedAt: new Date().toISOString(),
    },
  };
  for (const [eventName, properties] of [
    ['session.started', { entryPoint: 'pickup_board' }],
    ['screen.viewed', { screenKey: 'pickup_board' }],
  ] as const) {
    const event = track(context, {
      clientEventId: createAnalyticsId(),
      occurredAt: new Date().toISOString(),
      eventName,
      properties,
    });
    if (event) transport.enqueue(event);
  }
  try { return await transport.flush(); }
  finally { transport.dispose(); }
}
