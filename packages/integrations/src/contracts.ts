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
  | 'oidc'
  | 'operator-portal';
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
  | 'manual-only'
  | 'coming-soon';

/**
 * How an organization owner actually finishes setup.
 *
 * - `one-click-oauth`: the deployment holds the client credentials, so the owner
 *   presses Connect once and the provider handles consent.
 * - `api-key`: the provider issues no OAuth client to us, so the owner copies a
 *   key from a named console screen. Steps must stay short and each carry a link.
 * - `operator-portal`: the provider publishes no API at all. The store links the
 *   portal and describes the manual export, and never offers a Connect button.
 */
export type ConnectorSetupKind = 'one-click-oauth' | 'api-key' | 'operator-portal';

/** One imperative instruction, optionally deep-linked to the exact screen. */
export interface ConnectorSetupStep {
  readonly text: string;
  readonly href?: string;
}

export interface ConnectorSetup {
  readonly kind: ConnectorSetupKind;
  /** Honest wall-clock estimate for the owner-facing work only. */
  readonly estimatedMinutes: number;
  /**
   * Provider console where credentials or exports are obtained. Absent when
   * there is nothing for a reader to open yet, so no link is rendered.
   */
  readonly consoleUrl?: string;
  readonly documentationUrl?: string;
  readonly steps: readonly ConnectorSetupStep[];
  /**
   * Callback path the operator registers with the provider. Present only when a
   * route actually serves it, so the panel never publishes a URL that 404s.
   */
  readonly redirectPath?: string;
}

export interface ConnectorLogo {
  /** Present only when a CC0 Simple Icons mark exists for the provider. */
  readonly simpleIconsSlug?: string;
  readonly sourceUrl: string;
  /**
   * `CC0-1.0` covers the Simple Icons set we bundle. Providers with no Simple
   * Icons entry — Amazon, Transistor and beehiiv among them — fall back to
   * initials rendered in the brand color, so no third-party asset is shipped.
   */
  readonly license: 'CC0-1.0' | 'brand-guidelines-initials';
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
  readonly setup: ConnectorSetup;
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
