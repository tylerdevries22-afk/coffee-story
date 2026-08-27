'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { ConnectorCard, IntegrationActivity } from '@/lib/integration-cards';

import { Icon } from './icon';
import { ProviderLogo } from './provider-logo';

type IntegrationWorkspaceProps = {
  readonly view: 'catalog' | 'connected' | 'activity' | 'health';
  readonly cards: readonly ConnectorCard[];
  readonly activity?: readonly IntegrationActivity[];
};

const COPY = {
  catalog: ['Integration catalog', 'Connect the operational tools your tenant already uses. Credentials remain server-only.'],
  connected: ['Connected integrations', 'Manage authorized accounts and incrementally enabled capabilities.'],
  activity: ['Integration activity', 'Review tenant-scoped synchronization, reconciliation, and retry history.'],
  health: ['Integration health', 'Monitor authorization, quotas, webhooks, and reconciliation readiness.'],
} as const;

function statusClass(card: ConnectorCard): string {
  if (card.status === 'connected-healthy') return 'success';
  if (card.status === 'connected-degraded' || card.status === 'reauthorization-required') return 'warning';
  return '';
}

function CatalogCard({ card }: { readonly card: ConnectorCard }) {
  return (
    <article className={`integration-card${card.isConnected ? ' connected' : ''}`}>
      <div className="integration-card-heading">
        <ProviderLogo card={card} active={card.isConnected} />
        <span className={`pill ${statusClass(card)}`.trim()}>{card.statusLabel}</span>
      </div>
      <div className="integration-card-copy">
        <h2>{card.displayName}</h2>
        <p>{card.summary}</p>
      </div>
      <dl className="integration-card-meta">
        <div><dt>Capabilities</dt><dd>{card.enabledCapabilityCount || card.capabilityCount}</dd></div>
        <div><dt>Account</dt><dd>{card.accountLabel ?? 'Not connected'}</dd></div>
      </dl>
      <div className="integration-card-footer">
        {card.canConfigure ? (
          <Link className="integration-card-action" href={`/integrations/${card.id}`}>
            {card.isConnected ? 'Manage' : 'Review setup'} <Icon name="chevron" size={14} />
          </Link>
        ) : (
          <span className="integration-card-disabled">Coming soon</span>
        )}
      </div>
    </article>
  );
}

function EmptyIntegrations({ view }: { readonly view: IntegrationWorkspaceProps['view'] }) {
  return (
    <div className="analytics-empty card">
      <Icon name="integrations" size={24} />
      <h2>No {view === 'connected' ? 'connected integrations' : 'integration activity'} yet</h2>
      <p>Connect a certified provider from the catalog. Missing credentials remain a setup state, never an error.</p>
      <Link className="button secondary" href="/integrations">Open catalog</Link>
    </div>
  );
}

export function IntegrationWorkspace({ view, cards, activity = [] }: IntegrationWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [title, description] = COPY[view];
  const visibleCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return cards.filter((card) =>
      (category === 'all' || card.category === category)
      && (!needle || `${card.displayName} ${card.summary}`.toLowerCase().includes(needle)),
    );
  }, [cards, category, query]);
  const visibleActivity = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return activity.filter((row) => !needle || `${row.providerName} ${row.capability}`.toLowerCase().includes(needle));
  }, [activity, query]);
  const healthyCount = visibleCards.filter((card) => card.status === 'connected-healthy').length;
  const attentionCount = visibleCards.filter((card) =>
    card.status === 'connected-degraded' || card.status === 'reauthorization-required',
  ).length;
  return (
    <div className="management-page">
      <header className="management-heading">
        <div><p className="eyebrow">Tenant operations</p><h1>{title}</h1><p className="subtitle">{description}</p></div>
        <span className="integration-security"><Icon name="lock" size={15} /> Secrets protected by Supabase Vault</span>
      </header>

      <div className="management-toolbar" aria-label="Integration filters">
        <label><span>Search providers</span><input type="search" name="provider" placeholder="Search integrations" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label><span>Category</span><select name="category" value={category} onChange={(event) => setCategory(event.target.value)} disabled={view === 'activity'}><option value="all">All categories</option><option value="commerce">Commerce</option><option value="finance">Finance</option><option value="communications">Communications</option><option value="marketing">Marketing</option><option value="platform">Platform</option></select></label>
        <span className="management-toolbar-count">{view === 'activity' ? visibleActivity.length : visibleCards.length} shown</span>
      </div>

      {view === 'activity' ? (
        visibleActivity.length ? (
          <div className="card management-table-card">
            <table><thead><tr><th>Provider</th><th>Capability</th><th>Status</th><th>Trigger</th><th className="num">Records</th><th>Started</th></tr></thead>
              <tbody>{visibleActivity.map((row) => <tr key={row.id}><td>{row.providerName}</td><td>{row.capability}</td><td><span className="pill">{row.status}</span></td><td>{row.trigger}</td><td className="num">{row.records.toLocaleString('en-US')}</td><td>{new Date(row.createdAt).toLocaleString('en-US')}</td></tr>)}</tbody>
            </table>
          </div>
        ) : <EmptyIntegrations view={view} />
      ) : view === 'health' ? (
        <>
          <div className="kpi-row integration-health-summary">
            <div className="kpi-card"><div className="label">Healthy</div><div className="value">{healthyCount}</div></div>
            <div className="kpi-card"><div className="label">Needs attention</div><div className="value">{attentionCount}</div></div>
            <div className="kpi-card"><div className="label">Last check</div><div className="value compact">On demand</div><div className="hint">No fabricated provider checks</div></div>
          </div>
          {visibleCards.length ? <div className="integration-grid">{visibleCards.map((card) => <CatalogCard key={card.id} card={card} />)}</div> : <EmptyIntegrations view={view} />}
        </>
      ) : visibleCards.length ? (
        <div className="integration-grid">{visibleCards.map((card) => <CatalogCard key={card.id} card={card} />)}</div>
      ) : <EmptyIntegrations view={view} />}
    </div>
  );
}
