import {
  certifiedOAuthProviders,
  withAuthorizableCapabilities,
  withConnectorAuthorization,
  type ConnectorCapabilityRow,
  type ConnectorCertificationRow,
} from './connector-auth-readiness';
import {
  connectorCardsOf,
  defaultConnectorCards,
  type ConnectorCard,
  type ConnectorInstallationRow,
  type ConnectorRegistryRow,
} from './integration-cards';

/** The shape a Supabase query returns, narrowed to what this decision reads. */
export type ConnectorQueryResult<T> = {
  readonly data: readonly T[] | null;
  readonly error: unknown;
};

/**
 * Turns four connector queries into cards, deciding what a partial read means.
 *
 * Split out from the IO so the failure branches are reachable in a unit test: the
 * loader itself needs a session before it can issue a query, which put this
 * decision — the one that produces the fail-closed rendering in production —
 * beyond the suite's reach.
 *
 * Losing the registry or the tenant's installations fails closed to the visible
 * but inert catalog, because neither the provider list nor the tenant's own
 * permission to act could be established. Losing only certification narrows the
 * actions instead: certification gates authorization, not visibility.
 */
export function connectorCardsFromQueries(
  registry: ConnectorQueryResult<ConnectorRegistryRow>,
  installations: ConnectorQueryResult<ConnectorInstallationRow>,
  capabilities: ConnectorQueryResult<ConnectorCapabilityRow>,
  certifications: ConnectorQueryResult<ConnectorCertificationRow>,
): readonly ConnectorCard[] {
  if (registry.error || installations.error) return defaultConnectorCards();
  const certified = capabilities.error || certifications.error
    ? new Set<string>()
    : certifiedOAuthProviders(
      registry.data ?? [], capabilities.data ?? [], certifications.data ?? [],
    );
  return withConnectorAuthorization(
    withAuthorizableCapabilities(
      connectorCardsOf(registry.data ?? [], installations.data ?? []),
      registry.data ?? [], capabilities.error ? [] : capabilities.data ?? [],
    ),
    certified,
  );
}
