'use client';

import {
  McpStore as SharedMcpStore,
  type McpStoreEntry,
  type McpStoreStatus,
} from 'franchise-mcp-store-ui';
import { useMemo } from 'react';

import { selectableConnectorIds, type ConnectorCard } from '@/lib/integration-cards';

import { ProviderLogo } from './provider-logo';

type McpStoreProps = {
  readonly cards: readonly ConnectorCard[];
  readonly mode?: 'manage' | 'select';
  readonly selected?: readonly string[];
  readonly onChange?: (selected: string[]) => void;
};

const POPULAR = new Set(['google-suite', 'quickbooks-online', 'slack']);

function sharedStatus(card: ConnectorCard, mode: 'manage' | 'select'): McpStoreStatus {
  if (card.status === 'connected-healthy') return 'connected';
  if (card.status === 'connected-degraded' || card.status === 'reauthorization-required') return 'reconnect';
  if (mode === 'select' ? !card.canConfigure : !card.connectHref) return 'unavailable';
  return 'not_connected';
}

function sharedEntry(card: ConnectorCard, mode: 'manage' | 'select'): McpStoreEntry {
  return {
    id: card.id,
    name: card.displayName,
    description: card.summary,
    type: card.category.charAt(0).toUpperCase() + card.category.slice(1),
    status: sharedStatus(card, mode),
    accountName: card.accountLabel,
    readiness: card.statusLabel,
    popular: POPULAR.has(card.id),
    selectable: card.canConfigure,
    detailHref: `/integrations/${card.id}`,
    connectHref: card.connectHref,
    connectLabel: card.connectLabel ?? undefined,
  };
}

export function McpStore({ cards, mode = 'manage', selected = [], onChange }: McpStoreProps) {
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const entries = useMemo(() => cards.map((card) => sharedEntry(card, mode)), [cards, mode]);
  const selectable = useMemo(() => selectableConnectorIds(cards, selected), [cards, selected]);
  return <div className={`mcp-store mcp-store-${mode}`}>
    {mode === 'select' ? selectable.map((id) => <input key={id} type="hidden" name="connectorIds" value={id} />) : null}
    <SharedMcpStore entries={entries} mode={mode} selectedIds={selectable}
      onSelectionChange={onChange} renderIcon={(entry) => {
        const card = byId.get(entry.id);
        return card ? <ProviderLogo card={card} active={selectable.includes(card.id)} /> : null;
      }} />
  </div>;
}
