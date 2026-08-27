import type { AnalyticsBatch, AnalyticsEventEnvelope, AnalyticsSurface } from '@platform/analytics';

export type TelemetryScope = {
  readonly brandId: string;
  readonly allowedLocationIds: ReadonlySet<string>;
  readonly kind: 'user' | 'device';
  readonly role?: 'customer' | 'staff' | 'location_manager' | 'brand_owner' | 'platform_admin';
  readonly deviceRole?: 'kiosk' | 'pos' | 'display' | 'prep';
  readonly deviceLocationId?: string;
};

export type AnalyticsInsertRow = {
  readonly client_event_id: string;
  readonly brand_id: string;
  readonly location_id: string | null;
  readonly surface: AnalyticsSurface;
  readonly event_key: string;
  readonly event_version: number;
  readonly app_version: string;
  readonly build_version: string;
  readonly actor_hash: string | null;
  readonly session_hash: string;
  readonly flow_key: string | null;
  readonly step_key: string | null;
  readonly metric_key: string | null;
  readonly outcome: string;
  readonly duration_ms: number | null;
  readonly consent_basis: 'essential' | 'consented';
  readonly properties: Readonly<Record<string, string | number | boolean | null>>;
  readonly occurred_at: string;
};

export type AnalyticsRpcEvent = AnalyticsEventEnvelope;

export class AnalyticsIngestionError extends Error {
  readonly code: 'clock_skew' | 'location_forbidden' | 'surface_forbidden' | 'tenant_mismatch';

  constructor(code: AnalyticsIngestionError['code']) {
    super('Analytics ingestion scope validation failed');
    this.name = 'AnalyticsIngestionError';
    this.code = code;
  }
}

function expectedDeviceSurface(role: NonNullable<TelemetryScope['deviceRole']>): AnalyticsSurface {
  if (role === 'kiosk') return 'kiosk';
  if (role === 'display') return 'display';
  return 'operator';
}

function surfaceAllowed(event: AnalyticsEventEnvelope, scope: TelemetryScope): boolean {
  if (scope.kind === 'device') {
    return scope.deviceRole !== undefined && event.surface === expectedDeviceSurface(scope.deviceRole);
  }
  if (scope.role === 'customer') return event.surface === 'customer';
  if (scope.role === 'staff') return event.surface === 'operator';
  return event.surface === 'operator' || event.surface === 'hq';
}

function locationFor(event: AnalyticsEventEnvelope, scope: TelemetryScope): string | null {
  if (scope.kind === 'device') {
    if (!scope.deviceLocationId) throw new AnalyticsIngestionError('location_forbidden');
    if (event.locationId && event.locationId !== scope.deviceLocationId) {
      throw new AnalyticsIngestionError('location_forbidden');
    }
    return scope.deviceLocationId;
  }
  if (!event.locationId) return null;
  if (!scope.allowedLocationIds.has(event.locationId)) {
    throw new AnalyticsIngestionError('location_forbidden');
  }
  return event.locationId;
}

function checkClock(occurredAt: string, now: Date): void {
  const timestamp = Date.parse(occurredAt);
  const delta = timestamp - now.getTime();
  if (delta > 5 * 60_000 || delta < -7 * 86_400_000) {
    throw new AnalyticsIngestionError('clock_skew');
  }
}

/** Converts a validated batch into tenant-derived, persistence-safe rows. */
export function analyticsRowsFor(
  batch: AnalyticsBatch,
  scope: TelemetryScope,
  now: Date,
): readonly AnalyticsInsertRow[] {
  return batch.events.map((event) => {
    if (event.brandId !== scope.brandId) throw new AnalyticsIngestionError('tenant_mismatch');
    if (!surfaceAllowed(event, scope)) throw new AnalyticsIngestionError('surface_forbidden');
    checkClock(event.occurredAt, now);
    return Object.freeze({
      client_event_id: event.clientEventId,
      brand_id: scope.brandId,
      location_id: locationFor(event, scope),
      surface: event.surface,
      event_key: event.eventName,
      event_version: event.schemaVersion,
      app_version: event.appVersion,
      build_version: event.appVersion,
      actor_hash: event.actorHash ?? null,
      session_hash: event.sessionHash,
      flow_key: event.flowKey ?? null,
      step_key: event.stepKey ?? null,
      metric_key: event.metricKey ?? null,
      outcome: event.outcome,
      duration_ms: event.durationMs ?? null,
      consent_basis: event.purpose === 'essential' ? 'essential' : 'consented',
      properties: event.properties,
      occurred_at: event.occurredAt,
    });
  });
}

/** Restores the validated public envelope expected by the atomic ingestion RPC. */
export function analyticsRpcEventsFor(
  rows: readonly AnalyticsInsertRow[],
): readonly AnalyticsRpcEvent[] {
  return rows.map((row) => Object.freeze({
    schemaVersion: row.event_version as AnalyticsEventEnvelope['schemaVersion'],
    clientEventId: row.client_event_id,
    occurredAt: row.occurred_at,
    brandId: row.brand_id,
    ...(row.location_id ? { locationId: row.location_id } : {}),
    surface: row.surface,
    appVersion: row.app_version,
    sessionHash: row.session_hash,
    ...(row.actor_hash ? { actorHash: row.actor_hash } : {}),
    eventName: row.event_key as AnalyticsEventEnvelope['eventName'],
    purpose: row.consent_basis === 'essential' ? 'essential' : 'behavioral',
    consentSource: 'tenant_policy',
    outcome: row.outcome as AnalyticsEventEnvelope['outcome'],
    ...(row.flow_key ? { flowKey: row.flow_key } : {}),
    ...(row.step_key ? { stepKey: row.step_key } : {}),
    ...(row.metric_key ? { metricKey: row.metric_key } : {}),
    ...(row.duration_ms === null ? {} : { durationMs: row.duration_ms }),
    properties: row.properties,
  }));
}
