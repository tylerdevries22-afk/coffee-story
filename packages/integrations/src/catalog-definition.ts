import {
  APP_ZAP_CONNECTOR_SCHEMA,
  type ConnectorAuthentication,
  type ConnectorAvailability,
  type ConnectorCapabilityDescriptor,
  type ConnectorCatalogEntry,
  type ConnectorCategory,
  type ConnectorHealthDimension,
  type ConnectorLogo,
  type ConnectorMapping,
  type ConnectorSetup,
} from './contracts';

export const API_VERSION = '2026-09-07';
const SIMPLE_ICONS = 'https://simpleicons.org';

export interface CatalogDefinition {
  readonly id: string;
  readonly provider: string;
  readonly displayName: string;
  readonly summary: string;
  readonly category: ConnectorCategory;
  readonly availability: ConnectorAvailability;
  readonly authentication: ConnectorAuthentication;
  readonly capabilities: readonly string[];
  readonly mapping: readonly ConnectorMapping[];
  readonly health: readonly ConnectorHealthDimension[];
  readonly logo: ConnectorLogo;
  readonly setup: ConnectorSetup;
  readonly webhooks?: boolean;
}

/** True only for providers whose adapter can run against a provider sandbox. */
function isApiBacked(availability: ConnectorAvailability): boolean {
  return availability === 'available' || availability === 'provider-approval-required';
}

function capability(id: string, apiBacked: boolean): ConnectorCapabilityDescriptor {
  return { id, idempotency: apiBacked, reconciliation: apiBacked, sandbox: apiBacked };
}

export function logo(
  slug: string,
  brandColor: `#${string}`,
  monochromeTreatment: ConnectorLogo['monochromeTreatment'] = 'allowed',
): ConnectorLogo {
  return {
    brandColor,
    license: 'CC0-1.0',
    attribution: 'Simple Icons contributors',
    verifiedAt: '2026-09-07',
    monochromeTreatment,
    simpleIconsSlug: slug,
    sourceUrl: `${SIMPLE_ICONS}/?q=${encodeURIComponent(slug)}`,
  };
}

/**
 * Describes a provider that Simple Icons does not carry. No mark is bundled;
 * the store renders the provider initials in `brandColor` instead, which keeps
 * us clear of every brand-guideline restriction.
 */
export function initialsLogo(
  brandColor: `#${string}`,
  brandGuidelinesUrl: string,
  attribution: string,
): ConnectorLogo {
  return {
    brandColor,
    license: 'brand-guidelines-initials',
    attribution,
    verifiedAt: '2026-09-07',
    monochromeTreatment: 'retain-official-mark',
    sourceUrl: brandGuidelinesUrl,
  };
}

/**
 * Builds the one-press OAuth setup block shared by every hosted-client provider.
 *
 * `redirectPath` must be passed explicitly and only when a route actually serves
 * it. Deriving it from the connector id would publish a callback URL that 404s
 * for any provider without a `/api/connectors/<id>/callback` handler, and would
 * override the real callback for a provider that serves one elsewhere.
 */
export function oauthSetup(
  input: Readonly<{
    consoleUrl: string;
    documentationUrl: string;
    operatorSteps: readonly ConnectorSetup['steps'][number][];
    estimatedMinutes?: number;
    redirectPath?: string;
    /** Set when no adapter is wired yet, so the steps promise nothing false. */
    awaitingRuntime?: boolean;
  }>,
): ConnectorSetup {
  const opening = input.awaitingRuntime
    ? 'Adapter certification is pending, so Connect activates once this provider is certified.'
    : 'Press Connect and approve the requested scopes.';
  return Object.freeze({
    kind: 'one-click-oauth' as const,
    estimatedMinutes: input.estimatedMinutes ?? 1,
    consoleUrl: input.consoleUrl,
    documentationUrl: input.documentationUrl,
    ...(input.redirectPath === undefined ? {} : { redirectPath: input.redirectPath }),
    steps: Object.freeze([
      Object.freeze({ text: opening }),
      ...input.operatorSteps.map((step) => Object.freeze({ ...step })),
    ]),
  });
}

/** The callback path served by the shared connector OAuth route. */
export function connectorCallbackPath(id: string): string {
  return `/api/connectors/${id}/callback`;
}

/** Builds a copy-a-key setup block for providers that issue no OAuth client to us. */
/**
 * Builds a copy-a-key setup block for providers that issue no OAuth client to us.
 *
 * The key belongs to one organization and is stored against its
 * `credential_references` row in Vault, so there is nothing for an operator to
 * put in the environment.
 */
export function apiKeySetup(
  input: Readonly<{
    consoleUrl: string;
    documentationUrl: string;
    steps: readonly ConnectorSetup['steps'][number][];
    estimatedMinutes?: number;
  }>,
): ConnectorSetup {
  return Object.freeze({
    kind: 'api-key' as const,
    estimatedMinutes: input.estimatedMinutes ?? 3,
    consoleUrl: input.consoleUrl,
    documentationUrl: input.documentationUrl,
    steps: Object.freeze(input.steps.map((step) => Object.freeze({ ...step }))),
  });
}

/** Builds a guided manual block for providers that publish no API at all. */
export function portalSetup(
  input: Readonly<{
    consoleUrl?: string;
    documentationUrl?: string;
    steps: readonly ConnectorSetup['steps'][number][];
    estimatedMinutes?: number;
  }>,
): ConnectorSetup {
  return Object.freeze({
    kind: 'operator-portal' as const,
    estimatedMinutes: input.estimatedMinutes ?? 5,
    ...(input.consoleUrl === undefined ? {} : { consoleUrl: input.consoleUrl }),
    ...(input.documentationUrl === undefined ? {} : { documentationUrl: input.documentationUrl }),
    steps: Object.freeze(input.steps.map((step) => Object.freeze({ ...step }))),
  });
}

export function entry(definition: CatalogDefinition): ConnectorCatalogEntry {
  const apiBacked = isApiBacked(definition.availability);
  return Object.freeze({
    availability: definition.availability,
    category: definition.category,
    descriptor: Object.freeze({
      $schema: APP_ZAP_CONNECTOR_SCHEMA,
      apiVersion: API_VERSION,
      authentication: definition.authentication,
      capabilities: Object.freeze(
        definition.capabilities.map((id) => Object.freeze(capability(id, apiBacked))),
      ),
      certification: Object.freeze({ evidenceIds: Object.freeze([]), state: 'uncertified' as const }),
      credentialOwnership: 'client' as const,
      health: Object.freeze([...definition.health]),
      id: definition.id,
      mapping: Object.freeze([...definition.mapping]),
      provider: definition.provider,
      resilience: Object.freeze({
        circuitBreaker: true as const,
        killSwitch: true as const,
        maximumAttempts: 2,
        timeoutMs: 10_000,
      }),
      webhooks: Object.freeze({
        deadLetters: true,
        inbox: true,
        replayProtection: true,
        signatureVerification: definition.webhooks ?? false,
      }),
    }),
    displayName: definition.displayName,
    logo: Object.freeze(definition.logo),
    setup: definition.setup,
    summary: definition.summary,
  });
}
