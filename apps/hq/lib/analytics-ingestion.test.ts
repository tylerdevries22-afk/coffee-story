import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createAnalyticsBatch, measure, track, type AnalyticsEventContext } from '@platform/analytics';

import {
  AnalyticsIngestionError,
  analyticsRowsFor,
  analyticsRpcEventsFor,
  type TelemetryScope,
} from './analytics-ingestion';

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const LOCATION_ID = '22222222-3333-4444-8555-666666666666';
const NOW = new Date('2026-08-27T18:00:00.000Z');
const CONTEXT: AnalyticsEventContext = {
  brandId: BRAND_ID,
  locationId: LOCATION_ID,
  surface: 'kiosk',
  appVersion: '1.0.0',
  sessionHash: `h1_${'a'.repeat(48)}`,
  consent: { essential: true, behavioral: true, source: 'user', updatedAt: NOW.toISOString() },
};
const DEVICE_SCOPE: TelemetryScope = {
  brandId: BRAND_ID,
  kind: 'device',
  deviceRole: 'kiosk',
  deviceLocationId: LOCATION_ID,
  allowedLocationIds: new Set([LOCATION_ID]),
};

describe('analyticsRowsFor', () => {
  it('derives tenant and device location while preserving bounded fields', () => {
    const event = measure(CONTEXT, {
      clientEventId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      occurredAt: NOW.toISOString(),
      metricKey: 'screen.ready',
      durationMs: 240,
    });
    const [row] = analyticsRowsFor(createAnalyticsBatch([event]), DEVICE_SCOPE, NOW);

    assert.equal(row?.brand_id, BRAND_ID);
    assert.equal(row?.location_id, LOCATION_ID);
    assert.equal(row?.metric_key, 'screen.ready');
    assert.equal(row?.consent_basis, 'essential');
  });

  it('denies cross-tenant, cross-location, and incorrect surface events', () => {
    const base = measure(CONTEXT, {
      clientEventId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      occurredAt: NOW.toISOString(), metricKey: 'screen.ready', durationMs: 1,
    });
    assert.throws(
      () => analyticsRowsFor(createAnalyticsBatch([{ ...base, brandId: '33333333-4444-4555-8666-777777777777' }]), DEVICE_SCOPE, NOW),
      (error: unknown) => error instanceof AnalyticsIngestionError && error.code === 'tenant_mismatch',
    );
    assert.throws(
      () => analyticsRowsFor(createAnalyticsBatch([{ ...base, locationId: '33333333-4444-4555-8666-777777777777' }]), DEVICE_SCOPE, NOW),
      (error: unknown) => error instanceof AnalyticsIngestionError && error.code === 'location_forbidden',
    );
    assert.throws(
      () => analyticsRowsFor(createAnalyticsBatch([{ ...base, surface: 'display' }]), DEVICE_SCOPE, NOW),
      (error: unknown) => error instanceof AnalyticsIngestionError && error.code === 'surface_forbidden',
    );
  });

  it('accepts customer behavior only for a verified tenant location', () => {
    const context = { ...CONTEXT, surface: 'customer' as const };
    const event = track(context, {
      clientEventId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      occurredAt: NOW.toISOString(), eventName: 'screen.viewed', properties: { screenKey: 'menu' },
    });
    assert.ok(event);
    const rows = analyticsRowsFor(createAnalyticsBatch([event]), {
      brandId: BRAND_ID, kind: 'user', role: 'customer', allowedLocationIds: new Set([LOCATION_ID]),
    }, NOW);
    assert.equal(rows[0]?.surface, 'customer');
  });

  it('rejects events outside the bounded offline and future-skew windows', () => {
    const event = measure(CONTEXT, {
      clientEventId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      occurredAt: '2026-08-20T17:59:59.000Z', metricKey: 'screen.ready', durationMs: 1,
    });
    assert.throws(
      () => analyticsRowsFor(createAnalyticsBatch([event]), DEVICE_SCOPE, NOW),
      (error: unknown) => error instanceof AnalyticsIngestionError && error.code === 'clock_skew',
    );
  });

  it('passes a tenant-derived camelCase envelope to the database RPC', () => {
    const event = measure(CONTEXT, {
      clientEventId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      occurredAt: NOW.toISOString(), metricKey: 'screen.ready', durationMs: 240,
    });
    const rows = analyticsRowsFor(createAnalyticsBatch([event]), DEVICE_SCOPE, NOW);
    const [payload] = analyticsRpcEventsFor(rows);

    assert.equal(payload?.clientEventId, event.clientEventId);
    assert.equal(payload?.brandId, BRAND_ID);
    assert.equal(payload?.locationId, LOCATION_ID);
    assert.equal(payload?.metricKey, 'screen.ready');
    assert.equal('client_event_id' in (payload ?? {}), false);
  });
});
