import type { ConnectorCard } from './integration-cards';
import {
  connectorProviderReady,
  connectorProviderScopes,
  isOAuthConnectorKey,
} from './connector-oauth-providers';

export type ConnectorCapabilityRow = {
  readonly id: string;
  readonly provider_id: string;
  readonly oauth_scopes: readonly string[];
};

export type ConnectorCertificationRow = {
  readonly capability_id: string;
  readonly certified_at: string | null;
  readonly environment: string;
  readonly status: string;
  readonly valid_until: string | null;
};

function has(...names: readonly string[]): boolean {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

function publicOriginReady(): boolean {
  return process.env.NODE_ENV !== 'production'
    || has('CONNECTOR_PUBLIC_ORIGIN')
    || has('PLATFORM_BASE_URL');
}

/** Adds only authorization links backed by a configured, implemented route. */
export function withConnectorAuthorization(
  cards: readonly ConnectorCard[],
  certifiedProviders: ReadonlySet<string> = new Set(),
): readonly ConnectorCard[] {
  const stateReady = has('CONNECTOR_OAUTH_STATE_SECRET')
    && (process.env.CONNECTOR_OAUTH_STATE_SECRET?.trim().length ?? 0) >= 32;
  return cards.map((card) => {
    if (card.id === 'square') {
      const ready = has('SQUARE_APP_ID', 'SQUARE_APP_SECRET', 'SQUARE_TOKEN_KEY');
      return { ...card, connectHref: ready ? '/locations' : null, connectLabel: 'Choose location' };
    }
    if (!isOAuthConnectorKey(card.id) || !certifiedProviders.has(card.id)
      || !stateReady || !publicOriginReady()
      || !connectorProviderReady(card.id)) return card;
    return {
      ...card,
      connectHref: `/api/connectors/${card.id}/authorize`,
      connectLabel: card.isInstalled ? 'Reconnect' : 'Connect',
    };
  });
}

export function certifiedOAuthProviders(
  registry: readonly { readonly id: string; readonly provider_key: string }[],
  capabilities: readonly ConnectorCapabilityRow[],
  certifications: readonly ConnectorCertificationRow[],
  now = Date.now(),
): ReadonlySet<string> {
  const passed = new Set(certifications.filter((row) => row.environment === 'sandbox'
    && row.status === 'passed' && Boolean(row.certified_at)
    && (!row.valid_until || Date.parse(row.valid_until) > now)).map((row) => row.capability_id));
  const byProvider = new Map<string, ConnectorCapabilityRow[]>();
  for (const capability of capabilities) {
    byProvider.set(capability.provider_id, [...(byProvider.get(capability.provider_id) ?? []), capability]);
  }
  return new Set(registry.filter((provider) => {
    if (!isOAuthConnectorKey(provider.provider_key)) return false;
    const granted = new Set(connectorProviderScopes(provider.provider_key));
    const enabled = (byProvider.get(provider.id) ?? []).filter((capability) =>
      capability.oauth_scopes.length === 0
      || capability.oauth_scopes.every((scope) => granted.has(scope)));
    return enabled.length > 0 && enabled.every((capability) => passed.has(capability.id));
  }).map((provider) => provider.provider_key));
}
