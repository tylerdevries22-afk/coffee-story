import { getConnectorCatalogEntry } from '@platform/integrations';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProviderLogo } from '@/components/provider-logo';
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
  const isComingSoon = definition.availability === 'coming-soon';
  const isUnavailable = !card.canConfigure && !card.isInstalled;
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
          <h2>{isComingSoon ? 'Certification pending' : isUnavailable ? 'Unavailable' : card.statusLabel}</h2>
          <p>{isComingSoon
            ? 'This adapter is listed for roadmap visibility and cannot be connected until its sandbox contract passes certification.'
            : isUnavailable
              ? 'This provider is not available in the active MCP catalog. Existing tenant history remains visible, but new setup is disabled.'
            : 'A brand owner must configure provider credentials and callback URLs in the deployed environment. Secrets are stored as Vault references and never sent to this browser.'}</p>
          {card.isConnected ? (
            <Link className="button secondary" href="/integrations/health">View latest health</Link>
          ) : card.connectHref && provider === 'square' ? (
            <Link className="button" href="/locations">Connect Square by location</Link>
          ) : card.connectHref ? (
            <a className="button" href={card.connectHref}>{card.connectLabel ?? 'Connect'}</a>
          ) : (
            <span className="integration-card-disabled">
              {isComingSoon ? 'Awaiting sandbox certification' : 'Awaiting provider configuration'}
            </span>
          )}
          <small>Configuration gaps remain explicit and do not interrupt the rest of HQ.</small>
        </aside>
      </div>
    </div>
  );
}
