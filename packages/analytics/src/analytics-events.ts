import {
  ANALYTICS_SCHEMA_VERSION, type AnalyticsEventContext, type AnalyticsEventDefinition,
  type AnalyticsEventEnvelope, type AnalyticsEventInput, type AnalyticsOutcome,
  type AnalyticsProperties,
} from './analytics-types';
import {
  DEFAULT_EVENT_DEFINITIONS, HASH_PATTERN, UUID_PATTERN, canCollect, fail, isIdentifier,
  isIsoTimestamp, validateContext, validateEventDefinition, validateProperties,
} from './analytics-validation';

/** Builds one validated event, or returns null when behavioral consent is absent. */
export function track(
  context: AnalyticsEventContext,
  input: AnalyticsEventInput,
  definition: AnalyticsEventDefinition = DEFAULT_EVENT_DEFINITIONS[input.eventName],
): AnalyticsEventEnvelope | null {
  validateContext(context);
  const validDefinition = validateEventDefinition(definition);
  if (validDefinition.key !== input.eventName) fail('INVALID_EVENT', ['Event definition key mismatch']);
  if (!canCollect(validDefinition, context.consent)) return null;
  const event = buildEnvelope(context, input, validDefinition);
  return validateAnalyticsEvent(event, validDefinition);
}

function buildEnvelope(
  context: AnalyticsEventContext,
  input: AnalyticsEventInput,
  definition: AnalyticsEventDefinition,
): AnalyticsEventEnvelope {
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    clientEventId: input.clientEventId,
    occurredAt: input.occurredAt,
    brandId: context.brandId,
    ...(context.locationId ? { locationId: context.locationId } : {}),
    surface: context.surface,
    appVersion: context.appVersion,
    sessionHash: context.sessionHash,
    ...(context.actorHash ? { actorHash: context.actorHash } : {}),
    eventName: input.eventName,
    purpose: definition.purpose,
    consentSource: context.consent.source,
    outcome: input.outcome ?? 'unknown',
    ...(input.flowKey ? { flowKey: input.flowKey } : {}),
    ...(input.stepKey ? { stepKey: input.stepKey } : {}),
    ...(input.metricKey ? { metricKey: input.metricKey } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    properties: Object.freeze({ ...(input.properties ?? {}) }),
  };
}

/** Validates an event envelope at a transport or persistence boundary. */
export function validateAnalyticsEvent(
  event: AnalyticsEventEnvelope,
  definition: AnalyticsEventDefinition = DEFAULT_EVENT_DEFINITIONS[event.eventName],
): AnalyticsEventEnvelope {
  const issues = collectEventIssues(event, definition);
  if (issues.length) {
    const code = issues.some((issue) => issue.toLowerCase().includes('property'))
      ? 'UNSAFE_PROPERTY'
      : 'INVALID_EVENT';
    fail(code, issues);
  }
  return Object.freeze({ ...event, properties: Object.freeze({ ...event.properties }) });
}

function collectEventIssues(
  event: AnalyticsEventEnvelope,
  definition: AnalyticsEventDefinition,
): string[] {
  const issues: string[] = [];
  if (event.schemaVersion !== ANALYTICS_SCHEMA_VERSION) issues.push('Unsupported schema version');
  if (!UUID_PATTERN.test(event.clientEventId)) issues.push('clientEventId must be a UUID');
  if (!UUID_PATTERN.test(event.brandId)) issues.push('brandId must be a UUID');
  if (event.locationId && !UUID_PATTERN.test(event.locationId)) issues.push('locationId must be a UUID');
  if (!isIsoTimestamp(event.occurredAt)) issues.push('occurredAt must be an ISO timestamp');
  if (!HASH_PATTERN.test(event.sessionHash)) issues.push('sessionHash must be a versioned pseudonymous hash');
  if (event.actorHash && !HASH_PATTERN.test(event.actorHash)) issues.push('actorHash must be a versioned pseudonymous hash');
  if (event.eventName !== definition.key || event.purpose !== definition.purpose) issues.push('Event definition mismatch');
  if (event.durationMs !== undefined && (!Number.isFinite(event.durationMs) || event.durationMs < 0 || event.durationMs > 86_400_000)) {
    issues.push('durationMs must be between 0 and 86400000');
  }
  for (const key of [event.flowKey, event.stepKey, event.metricKey]) {
    if (key !== undefined && !isIdentifier(key)) issues.push('Flow, step, and metric keys must be stable identifiers');
  }
  issues.push(...validateProperties(event.properties, definition.allowedProperties));
  return issues;
}

interface TimedEventInput {
  readonly clientEventId: string;
  readonly occurredAt: string;
  readonly properties?: AnalyticsProperties;
}

interface FlowEventInput extends TimedEventInput {
  readonly flowKey: string;
}

interface FlowStepEventInput extends FlowEventInput {
  readonly stepKey: string;
}

/** Creates a behavioral flow-start event. */
export function startFlow(context: AnalyticsEventContext, input: FlowEventInput): AnalyticsEventEnvelope | null {
  return track(context, { ...input, eventName: 'flow.started' });
}

/** Creates a behavioral flow-step completion event. */
export function completeStep(context: AnalyticsEventContext, input: FlowStepEventInput): AnalyticsEventEnvelope | null {
  return track(context, { ...input, eventName: 'flow.step_completed', outcome: 'success' });
}

/** Creates a behavioral flow-completion event. */
export function completeFlow(context: AnalyticsEventContext, input: FlowEventInput): AnalyticsEventEnvelope | null {
  return track(context, { ...input, eventName: 'flow.completed', outcome: 'success' });
}

/** Creates a behavioral flow-abandonment event. */
export function abandonFlow(context: AnalyticsEventContext, input: FlowEventInput): AnalyticsEventEnvelope | null {
  return track(context, { ...input, eventName: 'flow.abandoned', outcome: 'cancelled' });
}

interface MeasureInput extends TimedEventInput {
  readonly metricKey: string;
  readonly durationMs: number;
  readonly outcome?: AnalyticsOutcome;
}

/** Creates an essential bounded-duration performance measurement. */
export function measure(context: AnalyticsEventContext, input: MeasureInput): AnalyticsEventEnvelope {
  const event = track(context, { ...input, eventName: 'performance.measured' });
  if (!event) fail('INVALID_EVENT', ['Essential measurements cannot be consent-gated']);
  return event;
}
