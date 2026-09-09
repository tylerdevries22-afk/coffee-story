import {
  ANALYTICS_EVENT_NAMES, AnalyticsContractError, MAX_PROPERTY_COUNT,
  MAX_PROPERTY_STRING_LENGTH, type AnalyticsConsentState, type AnalyticsErrorCode,
  type AnalyticsEventContext, type AnalyticsEventDefinition, type AnalyticsEventName,
  type AnalyticsProperties, type AnalyticsPropertyValue,
} from './analytics-types';

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const HASH_PATTERN = /^h1_[A-Za-z0-9_-]{32,128}$/;
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

export function fail(code: AnalyticsErrorCode, issues: readonly string[]): never {
  throw new AnalyticsContractError(code, issues);
}

export function isIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

export function isIdentifier(value: string): boolean {
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

export function validateProperties(
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

export function validateContext(context: AnalyticsEventContext): void {
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
