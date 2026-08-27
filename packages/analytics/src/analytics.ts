export const ANALYTICS_SCHEMA_VERSION = 1 as const;
export const MAX_BATCH_EVENTS = 50;
export const MAX_PROPERTY_COUNT = 20;
export const MAX_PROPERTY_STRING_LENGTH = 128;

export const ANALYTICS_EVENT_NAMES = [
  'session.started',
  'screen.viewed',
  'interaction.completed',
  'flow.started',
  'flow.step_completed',
  'flow.completed',
  'flow.abandoned',
  'performance.measured',
  'error.occurred',
  'sync.state_changed',
  'consent.updated',
] as const;

export type AnalyticsSurface = 'customer' | 'operator' | 'kiosk' | 'display' | 'hq';
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];
export type AnalyticsPurpose = 'essential' | 'behavioral';
export type AnalyticsOutcome = 'success' | 'failure' | 'cancelled' | 'unknown';
export type AnalyticsPropertyValue = string | number | boolean | null;
export type AnalyticsProperties = Readonly<Record<string, AnalyticsPropertyValue>>;

export interface AnalyticsConsentState {
  readonly essential: true;
  readonly behavioral: boolean;
  readonly source: 'default' | 'user' | 'tenant_policy';
  readonly updatedAt: string;
}

export interface AnalyticsEventDefinition {
  readonly key: AnalyticsEventName;
  readonly purpose: AnalyticsPurpose;
  readonly allowedProperties: readonly string[];
}

export interface AnalyticsFunnelStep {
  readonly key: string;
  readonly label: string;
  readonly order: number;
}

export interface AnalyticsFunnelDefinition {
  readonly key: string;
  readonly version: number;
  readonly label: string;
  readonly steps: readonly AnalyticsFunnelStep[];
}

export type AnalyticsMetricFormula =
  | 'count'
  | 'unique_sessions'
  | 'completion_rate'
  | 'duration_percentile';

export interface AnalyticsMetricDefinition {
  readonly key: string;
  readonly version: number;
  readonly label: string;
  readonly formula: AnalyticsMetricFormula;
  readonly eventName: AnalyticsEventName;
  readonly percentile?: 50 | 75 | 90 | 95 | 99;
}

export interface AnalyticsEventContext {
  readonly brandId: string;
  readonly locationId?: string;
  readonly surface: AnalyticsSurface;
  readonly appVersion: string;
  readonly sessionHash: string;
  readonly actorHash?: string;
  readonly consent: AnalyticsConsentState;
}

export interface AnalyticsEventInput {
  readonly clientEventId: string;
  readonly occurredAt: string;
  readonly eventName: AnalyticsEventName;
  readonly outcome?: AnalyticsOutcome;
  readonly flowKey?: string;
  readonly stepKey?: string;
  readonly metricKey?: string;
  readonly durationMs?: number;
  readonly properties?: AnalyticsProperties;
}

export interface AnalyticsEventEnvelope {
  readonly schemaVersion: typeof ANALYTICS_SCHEMA_VERSION;
  readonly clientEventId: string;
  readonly occurredAt: string;
  readonly brandId: string;
  readonly locationId?: string;
  readonly surface: AnalyticsSurface;
  readonly appVersion: string;
  readonly sessionHash: string;
  readonly actorHash?: string;
  readonly eventName: AnalyticsEventName;
  readonly purpose: AnalyticsPurpose;
  readonly consentSource: AnalyticsConsentState['source'];
  readonly outcome: AnalyticsOutcome;
  readonly flowKey?: string;
  readonly stepKey?: string;
  readonly metricKey?: string;
  readonly durationMs?: number;
  readonly properties: AnalyticsProperties;
}

export interface AnalyticsBatch {
  readonly schemaVersion: typeof ANALYTICS_SCHEMA_VERSION;
  readonly events: readonly AnalyticsEventEnvelope[];
}

export type AnalyticsErrorCode =
  | 'INVALID_CONTEXT'
  | 'INVALID_DEFINITION'
  | 'INVALID_EVENT'
  | 'INVALID_FUNNEL'
  | 'INVALID_METRIC'
  | 'UNSAFE_PROPERTY'
  | 'BATCH_LIMIT_EXCEEDED';

export class AnalyticsContractError extends Error {
  readonly code: AnalyticsErrorCode;
  readonly issues: readonly string[];

  constructor(code: AnalyticsErrorCode, issues: readonly string[]) {
    super('Analytics contract validation failed');
    this.name = 'AnalyticsContractError';
    this.code = code;
    this.issues = [...issues];
  }
}

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^h1_[A-Za-z0-9_-]{32,128}$/;
const PROPERTY_KEY_PATTERN = /^[a-z][a-zA-Z0-9]{0,39}$/;
const BLOCKED_PROPERTY_WORDS = new Set([
  'address', 'card', 'email', 'message', 'name', 'note', 'password', 'payment',
  'phone', 'query', 'search', 'secret', 'token',
]);

const DEFAULT_ALLOWED_PROPERTIES: Readonly<Record<AnalyticsEventName, readonly string[]>> = {
  'session.started': ['entryPoint'],
  'screen.viewed': ['screenKey'],
  'interaction.completed': ['interactionKey'],
  'flow.started': [],
  'flow.step_completed': [],
  'flow.completed': [],
  'flow.abandoned': ['reasonCode'],
  'performance.measured': [],
  'error.occurred': ['errorCode', 'dependencyKey', 'retryable'],
  'sync.state_changed': ['syncKey', 'previousState', 'nextState'],
  'consent.updated': ['behavioralAllowed'],
};

const ESSENTIAL_EVENTS = new Set<AnalyticsEventName>([
  'performance.measured', 'error.occurred', 'sync.state_changed', 'consent.updated',
]);

export const DEFAULT_EVENT_DEFINITIONS: Readonly<Record<AnalyticsEventName, AnalyticsEventDefinition>> =
  Object.fromEntries(ANALYTICS_EVENT_NAMES.map((key) => [key, {
    key,
    purpose: ESSENTIAL_EVENTS.has(key) ? 'essential' : 'behavioral',
    allowedProperties: DEFAULT_ALLOWED_PROPERTIES[key],
  }])) as Readonly<Record<AnalyticsEventName, AnalyticsEventDefinition>>;

function fail(code: AnalyticsErrorCode, issues: readonly string[]): never {
  throw new AnalyticsContractError(code, issues);
}

function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isIdentifier(value: string): boolean {
  return value.length <= 80 && IDENTIFIER_PATTERN.test(value);
}

function propertyWords(key: string): readonly string[] {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/);
}

function validatePropertyKey(key: string): readonly string[] {
  if (!PROPERTY_KEY_PATTERN.test(key)) return [`Invalid property key: ${key}`];
  if (propertyWords(key).some((word) => BLOCKED_PROPERTY_WORDS.has(word))) {
    return [`Sensitive property key is not allowed: ${key}`];
  }
  return [];
}

function validatePropertyValue(key: string, value: AnalyticsPropertyValue): readonly string[] {
  if (typeof value === 'string' && value.length > MAX_PROPERTY_STRING_LENGTH) {
    return [`Property ${key} exceeds ${MAX_PROPERTY_STRING_LENGTH} characters`];
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000)) {
    return [`Property ${key} must be a bounded finite number`];
  }
  return [];
}

function validateProperties(
  properties: AnalyticsProperties,
  allowedProperties: readonly string[],
): readonly string[] {
  const entries = Object.entries(properties);
  const issues = entries.length > MAX_PROPERTY_COUNT
    ? [`Events support at most ${MAX_PROPERTY_COUNT} properties`]
    : [];
  for (const [key, value] of entries) {
    issues.push(...validatePropertyKey(key), ...validatePropertyValue(key, value));
    if (!allowedProperties.includes(key)) issues.push(`Property is not allowed for this event: ${key}`);
  }
  return issues;
}

function validateContext(context: AnalyticsEventContext): void {
  const issues: string[] = [];
  if (!UUID_PATTERN.test(context.brandId)) issues.push('brandId must be a UUID');
  if (context.locationId && !UUID_PATTERN.test(context.locationId)) issues.push('locationId must be a UUID');
  if (!HASH_PATTERN.test(context.sessionHash)) issues.push('sessionHash must be a versioned pseudonymous hash');
  if (context.actorHash && !HASH_PATTERN.test(context.actorHash)) issues.push('actorHash must be a versioned pseudonymous hash');
  if (!context.appVersion || context.appVersion.length > 64) issues.push('appVersion must contain 1-64 characters');
  if (context.consent.essential !== true) issues.push('essential consent state must be true');
  if (!isIsoTimestamp(context.consent.updatedAt)) issues.push('consent.updatedAt must be an ISO timestamp');
  if (issues.length) fail('INVALID_CONTEXT', issues);
}

/** Returns whether the consent state permits collection of an event definition. */
export function canCollect(
  definition: AnalyticsEventDefinition,
  consent: AnalyticsConsentState,
): boolean {
  return definition.purpose === 'essential' || consent.behavioral;
}

/** Validates and returns an immutable event definition. */
export function validateEventDefinition(definition: AnalyticsEventDefinition): AnalyticsEventDefinition {
  const issues: string[] = [];
  if (!ANALYTICS_EVENT_NAMES.includes(definition.key)) issues.push('Unknown analytics event key');
  for (const key of definition.allowedProperties) issues.push(...validatePropertyKey(key));
  if (new Set(definition.allowedProperties).size !== definition.allowedProperties.length) {
    issues.push('allowedProperties must be unique');
  }
  if (issues.length) fail('INVALID_DEFINITION', issues);
  return Object.freeze({ ...definition, allowedProperties: Object.freeze([...definition.allowedProperties]) });
}

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

/** Validates a stable, ordered funnel definition. */
export function validateFunnelDefinition(definition: AnalyticsFunnelDefinition): AnalyticsFunnelDefinition {
  const issues: string[] = [];
  if (!isIdentifier(definition.key)) issues.push('Funnel key must be a stable identifier');
  if (!Number.isInteger(definition.version) || definition.version < 1) issues.push('Funnel version must be positive');
  if (!definition.label.trim() || definition.label.length > 120) issues.push('Funnel label must contain 1-120 characters');
  if (definition.steps.length < 2 || definition.steps.length > 20) issues.push('Funnels require 2-20 steps');
  const keys = new Set<string>();
  definition.steps.forEach((step, index) => {
    if (!isIdentifier(step.key)) issues.push(`Invalid funnel step key at index ${index}`);
    if (!step.label.trim() || step.label.length > 120) issues.push(`Invalid funnel step label at index ${index}`);
    if (step.order !== index) issues.push('Funnel step order must be zero-based and contiguous');
    if (keys.has(step.key)) issues.push(`Duplicate funnel step key: ${step.key}`);
    keys.add(step.key);
  });
  if (issues.length) fail('INVALID_FUNNEL', issues);
  return Object.freeze({ ...definition, steps: Object.freeze(definition.steps.map((step) => Object.freeze({ ...step }))) });
}

/** Validates a metric definition that can be resolved without tenant-authored SQL. */
export function validateMetricDefinition(definition: AnalyticsMetricDefinition): AnalyticsMetricDefinition {
  const issues: string[] = [];
  if (!isIdentifier(definition.key)) issues.push('Metric key must be a stable identifier');
  if (!Number.isInteger(definition.version) || definition.version < 1) issues.push('Metric version must be positive');
  if (!definition.label.trim() || definition.label.length > 120) issues.push('Metric label must contain 1-120 characters');
  const needsPercentile = definition.formula === 'duration_percentile';
  if (needsPercentile !== (definition.percentile !== undefined)) {
    issues.push('Only duration_percentile metrics require a percentile');
  }
  if (issues.length) fail('INVALID_METRIC', issues);
  return Object.freeze({ ...definition });
}

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
