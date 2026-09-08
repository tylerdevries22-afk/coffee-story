'use client';

import { McpStore as SharedMcpStore } from 'franchise-mcp-store-ui';
import { useMemo } from 'react';

import { sharedEntry } from '@/lib/mcp-store-projection';
import { selectableConnectorIds, type ConnectorCard } from '@/lib/integration-cards';

import { ProviderLogo } from './provider-logo';

type McpStoreProps = {
  readonly cards: readonly ConnectorCard[];
  readonly mode?: 'manage' | 'select';
  readonly selected?: readonly string[];
  readonly onChange?: (selected: string[]) => void;
};

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
