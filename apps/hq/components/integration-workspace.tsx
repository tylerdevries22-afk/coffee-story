'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { ConnectorCard, IntegrationActivity } from '@/lib/integration-cards';

import { Icon } from './icon';
import { McpStore } from './mcp-store';

type IntegrationWorkspaceProps = {
  readonly view: 'catalog' | 'connected' | 'activity' | 'health';
  readonly cards: readonly ConnectorCard[];
  readonly activity?: readonly IntegrationActivity[];
};

const COPY = {
  catalog: ['MCP Store', 'Add production-ready tools using the same tenant-safe connector contracts across every organization.'],
  connected: ['Connected integrations', 'Manage authorized accounts and incrementally enabled capabilities.'],
  activity: ['Integration activity', 'Review tenant-scoped synchronization, reconciliation, and retry history.'],
  health: ['Integration health', 'Monitor authorization, quotas, webhooks, and reconciliation readiness.'],
} as const;

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
  const [title, description] = COPY[view];
  const visibleActivity = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return activity.filter((row) => !needle || `${row.providerName} ${row.capability}`.toLowerCase().includes(needle));
  }, [activity, query]);
  const healthyCount = cards.filter((card) => card.status === 'connected-healthy').length;
  const attentionCount = cards.filter((card) =>
    card.status === 'connected-degraded' || card.status === 'reauthorization-required',
  ).length;
  return (
    <div className="management-page">
      <header className="management-heading">
        <div><p className="eyebrow">Tenant operations</p><h1>{title}</h1><p className="subtitle">{description}</p></div>
        <span className="integration-security"><Icon name="lock" size={15} /> Secrets protected by Supabase Vault</span>
      </header>

      {view === 'activity' ? <div className="management-toolbar" aria-label="Integration filters">
        <label><span>Search activity</span><input type="search" name="provider" placeholder="Search integrations"
          value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <span className="management-toolbar-count">{visibleActivity.length} shown</span>
      </div> : null}

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
          {cards.length ? <McpStore cards={cards} /> : <EmptyIntegrations view={view} />}
        </>
      ) : cards.length ? (
        <McpStore cards={cards} />
      ) : <EmptyIntegrations view={view} />}
    </div>
  );
}
