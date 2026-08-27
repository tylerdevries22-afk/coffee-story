import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ANALYTICS_SCHEMA_VERSION,
  AnalyticsContractError,
  abandonFlow,
  canCollect,
  completeFlow,
  completeStep,
  createAnalyticsBatch,
  DEFAULT_EVENT_DEFINITIONS,
  MAX_BATCH_EVENTS,
  measure,
  parseAnalyticsBatch,
  startFlow,
  track,
  validateAnalyticsEvent,
  validateEventDefinition,
  validateFunnelDefinition,
  validateMetricDefinition,
  type AnalyticsConsentState,
  type AnalyticsEventContext,
} from './analytics';

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOW = '2026-08-27T18:00:00.000Z';
const HASH = `h1_${'a'.repeat(48)}`;

const allowedConsent: AnalyticsConsentState = {
  essential: true,
  behavioral: true,
  source: 'user',
  updatedAt: NOW,
};

const context: AnalyticsEventContext = {
  brandId: BRAND_ID,
  surface: 'kiosk',
  appVersion: '1.4.0',
  sessionHash: HASH,
  consent: allowedConsent,
};

function eventIdentity(index = 0) {
  const suffix = index.toString(16).padStart(12, '0');
  return { clientEventId: `aaaaaaaa-bbbb-4ccc-8ddd-${suffix}`, occurredAt: NOW };
}

describe('consent and definitions', () => {
  it('gates behavioral events while always permitting essential events', () => {
    const denied = { ...allowedConsent, behavioral: false };
    assert.equal(canCollect(DEFAULT_EVENT_DEFINITIONS['screen.viewed'], denied), false);
    assert.equal(canCollect(DEFAULT_EVENT_DEFINITIONS['error.occurred'], denied), true);
  });

  it('validates and freezes a safe event definition', () => {
    const result = validateEventDefinition(DEFAULT_EVENT_DEFINITIONS['screen.viewed']);
    assert.equal(result.key, 'screen.viewed');
    assert.equal(Object.isFrozen(result.allowedProperties), true);
  });

  it('rejects sensitive property names in definitions', () => {
    assert.throws(
      () => validateEventDefinition({ key: 'screen.viewed', purpose: 'behavioral', allowedProperties: ['emailAddress'] }),
      (error: unknown) => error instanceof AnalyticsContractError && error.code === 'INVALID_DEFINITION',
    );
  });
});

describe('track', () => {
  it('creates a validated pseudonymous envelope', () => {
    const event = track(context, {
      clientEventId: EVENT_ID,
      occurredAt: NOW,
      eventName: 'screen.viewed',
      properties: { screenKey: 'menu' },
    });
    assert.equal(event?.schemaVersion, ANALYTICS_SCHEMA_VERSION);
    assert.equal(event?.brandId, BRAND_ID);
    assert.deepEqual(event?.properties, { screenKey: 'menu' });
  });

  it('returns null when behavioral consent is absent', () => {
    const event = track(
      { ...context, consent: { ...allowedConsent, behavioral: false } },
      { ...eventIdentity(), eventName: 'screen.viewed' },
    );
    assert.equal(event, null);
  });

  it('rejects unapproved, excessive, and non-finite property values', () => {
    assert.throws(
      () => track(context, { ...eventIdentity(), eventName: 'screen.viewed', properties: { emailAddress: 'x@y.test' } }),
      (error: unknown) => error instanceof AnalyticsContractError && error.code === 'UNSAFE_PROPERTY',
    );
    assert.throws(
      () => track(context, { ...eventIdentity(), eventName: 'screen.viewed', properties: { screenKey: 'x'.repeat(129) } }),
      AnalyticsContractError,
    );
    const definition = { key: 'screen.viewed' as const, purpose: 'behavioral' as const, allowedProperties: ['sampleValue'] };
    assert.throws(
      () => track(context, { ...eventIdentity(), eventName: 'screen.viewed', properties: { sampleValue: Number.POSITIVE_INFINITY } }, definition),
      AnalyticsContractError,
    );
  });

  it('rejects raw identifiers and invalid transport fields', () => {
    assert.throws(
      () => track({ ...context, sessionHash: 'customer@example.com' }, { ...eventIdentity(), eventName: 'screen.viewed' }),
      (error: unknown) => error instanceof AnalyticsContractError && error.code === 'INVALID_CONTEXT',
    );
    assert.throws(
      () => track(context, { ...eventIdentity(), occurredAt: 'tomorrow', eventName: 'screen.viewed' }),
      AnalyticsContractError,
    );
  });
});

describe('flow helpers', () => {
  it('creates start, step, completion, and abandonment events', () => {
    assert.equal(startFlow(context, { ...eventIdentity(1), flowKey: 'checkout' })?.eventName, 'flow.started');
    assert.equal(completeStep(context, { ...eventIdentity(2), flowKey: 'checkout', stepKey: 'payment' })?.outcome, 'success');
    assert.equal(completeFlow(context, { ...eventIdentity(3), flowKey: 'checkout' })?.eventName, 'flow.completed');
    assert.equal(abandonFlow(context, { ...eventIdentity(4), flowKey: 'checkout' })?.outcome, 'cancelled');
  });

  it('applies behavioral consent to every flow helper', () => {
    const deniedContext = { ...context, consent: { ...allowedConsent, behavioral: false } };
    assert.equal(startFlow(deniedContext, { ...eventIdentity(1), flowKey: 'checkout' }), null);
    assert.equal(completeStep(deniedContext, { ...eventIdentity(2), flowKey: 'checkout', stepKey: 'payment' }), null);
    assert.equal(completeFlow(deniedContext, { ...eventIdentity(3), flowKey: 'checkout' }), null);
    assert.equal(abandonFlow(deniedContext, { ...eventIdentity(4), flowKey: 'checkout' }), null);
  });
});

describe('measure and envelope validation', () => {
  it('keeps essential performance measurements when behavioral consent is absent', () => {
    const result = measure(
      { ...context, consent: { ...allowedConsent, behavioral: false } },
      { ...eventIdentity(), metricKey: 'checkout.ready', durationMs: 245 },
    );
    assert.equal(result.purpose, 'essential');
    assert.equal(result.durationMs, 245);
  });

  it('rejects unbounded durations and definition mismatches', () => {
    assert.throws(
      () => measure(context, { ...eventIdentity(), metricKey: 'checkout.ready', durationMs: 86_400_001 }),
      AnalyticsContractError,
    );
    const event = measure(context, { ...eventIdentity(), metricKey: 'checkout.ready', durationMs: 12 });
    assert.throws(
      () => validateAnalyticsEvent(
        { ...event, eventName: 'error.occurred' },
        DEFAULT_EVENT_DEFINITIONS['performance.measured'],
      ),
      AnalyticsContractError,
    );
  });
});

describe('tenant definitions', () => {
  it('validates ordered franchise-neutral funnels', () => {
    const funnel = validateFunnelDefinition({
      key: 'primary.checkout',
      version: 1,
      label: 'Primary conversion',
      steps: [
        { key: 'item.selected', label: 'Select item', order: 0 },
        { key: 'order.completed', label: 'Complete order', order: 1 },
      ],
    });
    assert.equal(funnel.steps.length, 2);
    assert.equal(Object.isFrozen(funnel.steps), true);
  });

  it('rejects duplicate or non-contiguous funnel steps', () => {
    assert.throws(
      () => validateFunnelDefinition({
        key: 'checkout', version: 1, label: 'Checkout',
        steps: [
          { key: 'started', label: 'Started', order: 0 },
          { key: 'started', label: 'Finished', order: 2 },
        ],
      }),
      (error: unknown) => error instanceof AnalyticsContractError && error.code === 'INVALID_FUNNEL',
    );
  });

  it('validates safe metric formulas and their percentile requirements', () => {
    const metric = validateMetricDefinition({
      key: 'checkout.duration.p95', version: 1, label: 'Checkout p95',
      formula: 'duration_percentile', eventName: 'performance.measured', percentile: 95,
    });
    assert.equal(metric.percentile, 95);
    assert.throws(
      () => validateMetricDefinition({
        key: 'orders', version: 1, label: 'Orders', formula: 'count',
        eventName: 'flow.completed', percentile: 95,
      }),
      (error: unknown) => error instanceof AnalyticsContractError && error.code === 'INVALID_METRIC',
    );
  });
});

describe('createAnalyticsBatch', () => {
  it('freezes a valid non-empty batch', () => {
    const event = measure(context, { ...eventIdentity(), metricKey: 'app.ready', durationMs: 10 });
    const batch = createAnalyticsBatch([event]);
    assert.equal(batch.events.length, 1);
    assert.equal(Object.isFrozen(batch.events), true);
  });

  it('rejects empty batches and batches over 50 events', () => {
    assert.throws(() => createAnalyticsBatch([]), AnalyticsContractError);
    const event = measure(context, { ...eventIdentity(), metricKey: 'app.ready', durationMs: 10 });
    assert.throws(
      () => createAnalyticsBatch(Array.from({ length: MAX_BATCH_EVENTS + 1 }, () => event)),
      (error: unknown) => error instanceof AnalyticsContractError && error.code === 'BATCH_LIMIT_EXCEEDED',
    );
  });
});

describe('parseAnalyticsBatch', () => {
  it('accepts a valid untrusted transport payload', () => {
    const event = measure(context, { ...eventIdentity(), metricKey: 'app.ready', durationMs: 10 });

    assert.equal(parseAnalyticsBatch({ schemaVersion: 1, events: [event] }).events[0]?.clientEventId, event.clientEventId);
  });

  it('rejects malformed batches and unknown events with structured errors', () => {
    assert.throws(() => parseAnalyticsBatch(null), AnalyticsContractError);
    assert.throws(
      () => parseAnalyticsBatch({
        schemaVersion: 1,
        events: [{ eventName: 'identity.exposed' }],
      }),
      (error: unknown) => error instanceof AnalyticsContractError && error.code === 'INVALID_EVENT',
    );
  });
});
