import {
  ANALYTICS_EVENT_NAMES, ANALYTICS_SCHEMA_VERSION, MAX_BATCH_EVENTS,
  type AnalyticsBatch, type AnalyticsEventEnvelope,
} from './analytics-types';
import { validateAnalyticsEvent } from './analytics-events';
import { DEFAULT_EVENT_DEFINITIONS, fail } from './analytics-validation';

/** Builds a non-empty ingestion batch containing no more than 50 events. */
export function createAnalyticsBatch(events: readonly AnalyticsEventEnvelope[]): AnalyticsBatch {
  if (events.length < 1 || events.length > MAX_BATCH_EVENTS) {
    fail('BATCH_LIMIT_EXCEEDED', [`Batches require 1-${MAX_BATCH_EVENTS} events`]);
  }
  const validated = events.map((event) => validateAnalyticsEvent(event));
  return Object.freeze({ schemaVersion: ANALYTICS_SCHEMA_VERSION, events: Object.freeze(validated) });
}

/** Parses and validates an untrusted ingestion payload without leaking runtime exceptions. */
export function parseAnalyticsBatch(input: unknown): AnalyticsBatch {
  if (typeof input !== 'object' || input === null) {
    fail('INVALID_EVENT', ['Batch must be an object']);
  }
  const candidate = input as { schemaVersion?: unknown; events?: unknown };
  if (candidate.schemaVersion !== ANALYTICS_SCHEMA_VERSION || !Array.isArray(candidate.events)) {
    fail('INVALID_EVENT', ['Batch schemaVersion and events are required']);
  }
  if (candidate.events.length < 1 || candidate.events.length > MAX_BATCH_EVENTS) {
    fail('BATCH_LIMIT_EXCEEDED', [`Batches require 1-${MAX_BATCH_EVENTS} events`]);
  }
  const parsed = candidate.events.map((rawEvent, index) => {
    if (typeof rawEvent !== 'object' || rawEvent === null) {
      fail('INVALID_EVENT', [`Event ${index} must be an object`]);
    }
    const event = rawEvent as AnalyticsEventEnvelope;
    if (!ANALYTICS_EVENT_NAMES.includes(event.eventName)) {
      fail('INVALID_EVENT', [`Event ${index} has an unknown eventName`]);
    }
    return validateAnalyticsEvent(event, DEFAULT_EVENT_DEFINITIONS[event.eventName]);
  });
  return Object.freeze({
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    events: Object.freeze(parsed),
  });
}
