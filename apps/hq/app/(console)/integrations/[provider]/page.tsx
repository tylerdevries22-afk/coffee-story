import { getConnectorCatalogEntry } from '@platform/integrations';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ConnectorSetupPanel } from '@/components/connector-setup-panel';
import { hasScopeGap } from '@/lib/mcp-store-projection';
import { ProviderLogo } from '@/components/provider-logo';
import { currentSession, hasRole } from '@/lib/auth';
import { visibleCredentialEnvKeys } from '@/lib/connector-oauth-providers';
import { loadConnectorCards } from '@/lib/integration-data';

export const dynamic = 'force-dynamic';

type IntegrationDetailPageProps = {
  readonly params: Promise<{ readonly provider: string }>;
};

export default async function IntegrationDetailPage({ params }: IntegrationDetailPageProps) {
  const { provider } = await params;
  const definition = getConnectorCatalogEntry(provider);
  if (!definition) notFound();
  const card = (await loadConnectorCards()).find((candidate) => candidate.id === provider);
  if (!card) notFound();
  // Redirect URIs and deployment secret names are operator detail, not tenant
  // detail, so they are resolved only for an organization owner.
  const session = await currentSession();
  const credentialEnvKeys = visibleCredentialEnvKeys(
    provider, session ? { isOrganizationOwner: hasRole(session, 'brand_owner') } : null,
  );
  const isComingSoon = definition.availability === 'coming-soon';
  const isUnavailable = !card.canConfigure && !card.isInstalled;
  // A granular consent screen can grant less than the connector lists, which reads
  // as healthy while silently delivering nothing. Say so, and offer re-consent.
  const scopeGap = hasScopeGap(card);
  const readinessNote = isComingSoon
    ? 'This adapter is listed for roadmap visibility and cannot be connected until its sandbox contract passes certification.'
    : isUnavailable
      ? 'This provider is not available in the active MCP catalog. Existing tenant history remains visible, but new setup is disabled.'
      : card.isManualOnly
        ? 'This provider publishes no API, so the steps below are the whole setup. Ingestion is not wired up yet, so nothing can be imported today.'
        : card.setup.kind === 'api-key'
          ? 'Follow the steps below to obtain the key. Storing it against this organization is not wired up yet, so setup cannot be completed today.'
          : 'Secrets are stored as Vault references and never sent to this browser.';
  return (
    <div className="management-page integration-detail-page">
      <header className="management-heading integration-detail-heading">
        <ProviderLogo card={card} active={card.isConnected} />
        <div>
          <p className="eyebrow">{definition.category} integration</p>
          <h1>{definition.displayName}</h1>
          <p className="subtitle">{definition.summary}</p>
        </div>
        <span className="pill">{card.statusLabel}</span>
      </header>
      <div className="grid-2">
        <section className="card">
          <h2>Capabilities</h2>
          <ul className="integration-capability-list">
            {definition.descriptor.capabilities.map((capability) => (
              <li key={capability.id}>
                <span>{capability.id.replaceAll('.', ' ')}</span>
                <small>{capability.sandbox ? 'Sandbox contract available' : 'Certification pending'}</small>
              </li>
            ))}
          </ul>
        </section>
        <aside className="card integration-setup-card">
          <p className="eyebrow">Connection readiness</p>
          <h2>{isComingSoon ? 'Certification pending'
            : scopeGap ? 'Partly authorized'
            : isUnavailable && !card.isManualOnly ? 'Unavailable' : card.statusLabel}</h2>
          <p>{scopeGap
            ? `This connection is healthy, but only ${card.enabledCapabilityCount} of ${card.authorizableCapabilityCount} capabilities were authorized. Reconnecting lets you approve the rest.`
            : readinessNote}</p>
          {card.isConnected && scopeGap && card.connectHref ? (
            <a className="button" href={card.connectHref}>Reconnect to widen access</a>
          ) : card.isConnected ? (
            <Link className="button secondary" href="/integrations/health">View latest health</Link>
          ) : card.connectHref && provider === 'square' ? (
            <Link className="button" href="/locations">Connect Square by location</Link>
          ) : card.connectHref ? (
            <a className="button" href={card.connectHref}>{card.connectLabel ?? 'Connect'}</a>
          ) : card.canConfigure && card.setup.consoleUrl ? (
            <a className="button secondary" href={card.setup.consoleUrl}
              rel="noreferrer noopener" target="_blank">Open provider console</a>
          ) : (
            <span className="integration-card-disabled">
              {isComingSoon ? 'Awaiting sandbox certification' : 'Awaiting provider configuration'}
            </span>
          )}
          <small>Configuration gaps remain explicit and do not interrupt the rest of HQ.</small>
        </aside>
      </div>
      {isComingSoon ? null
        : <ConnectorSetupPanel card={card} credentialEnvKeys={credentialEnvKeys} />}
    </div>
  );
}
