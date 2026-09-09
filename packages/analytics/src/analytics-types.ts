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
