export const APP_ZAP_CONNECTOR_SCHEMA =
  'https://schemas.app-zap.dev/connectors/connector-descriptor.schema.json' as const;

export const CONNECTOR_ENVIRONMENTS = [
  'local',
  'demo',
  'staging',
  'production',
] as const;

export type ConnectorEnvironment = (typeof CONNECTOR_ENVIRONMENTS)[number];
export type ConnectorAuthentication =
  | 'oauth2'
  | 'api-key-reference'
  | 'service-account-reference'
  | 'oidc';
export type ConnectorMapping = 'organization' | 'account' | 'location';
export type ConnectorHealthDimension =
  | 'auth'
  | 'read'
  | 'write'
  | 'webhook'
  | 'quota'
  | 'reconciliation';
export type ConnectorCertificationState =
  | 'uncertified'
  | 'certified'
  | 'expired'
  | 'blocked';

export interface ConnectorCapabilityDescriptor {
  readonly id: string;
  readonly sandbox: boolean;
  readonly idempotency: boolean;
  readonly reconciliation: boolean;
}

export interface ConnectorCertification {
  readonly state: ConnectorCertificationState;
  readonly evidenceIds: readonly string[];
  readonly expiresAt?: string;
}

export interface ConnectorDescriptor {
  readonly $schema: typeof APP_ZAP_CONNECTOR_SCHEMA;
  readonly id: string;
  readonly provider: string;
  readonly apiVersion: string;
  readonly authentication: ConnectorAuthentication;
  readonly credentialOwnership: 'client';
  readonly capabilities: readonly ConnectorCapabilityDescriptor[];
  readonly mapping: readonly ConnectorMapping[];
  readonly resilience: {
    readonly timeoutMs: number;
    readonly maximumAttempts: number;
    readonly circuitBreaker: true;
    readonly killSwitch: true;
  };
  readonly webhooks: {
    readonly signatureVerification: boolean;
    readonly replayProtection: boolean;
    readonly inbox: boolean;
    readonly deadLetters: boolean;
  };
  readonly health: readonly ConnectorHealthDimension[];
  readonly certification: ConnectorCertification;
}

export type ConnectorCategory =
  | 'commerce'
  | 'communications'
  | 'finance'
  | 'marketing'
  | 'platform';
export type ConnectorAvailability =
  | 'available'
  | 'provider-approval-required'
  | 'coming-soon';

export interface ConnectorLogo {
  readonly simpleIconsSlug?: string;
  readonly sourceUrl: string;
  readonly license: 'CC0-1.0';
  readonly attribution: string;
  readonly verifiedAt: string;
  readonly brandColor: `#${string}`;
  readonly monochromeTreatment: 'allowed' | 'retain-official-mark';
}

export interface ConnectorCatalogEntry {
  readonly descriptor: ConnectorDescriptor;
  readonly displayName: string;
  readonly summary: string;
  readonly category: ConnectorCategory;
  readonly availability: ConnectorAvailability;
  readonly logo: ConnectorLogo;
}

export interface ConnectorOperationContext {
  readonly organizationId: string;
  readonly installationId: string;
  readonly locationId?: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly environment: ConnectorEnvironment;
  readonly deadlineAt: string;
  readonly cancellationSignal?: AbortSignal;
}

export interface ConnectorFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly correlationId: string;
  readonly attempts: number;
}

export type ConnectorOperationResult<T> =
  | { readonly ok: true; readonly value: T; readonly attempts: number }
  | { readonly ok: false; readonly error: ConnectorFailure };
