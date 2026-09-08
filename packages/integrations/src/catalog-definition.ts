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

export { apiKeySetup, connectorCallbackPath, oauthSetup, portalSetup } from './catalog-setup';

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
