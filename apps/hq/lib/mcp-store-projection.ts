import type { McpStoreEntry, McpStoreSetup, McpStoreStatus } from 'franchise-mcp-store-ui';

import type { ConnectorCard } from './integration-cards';

type StoreMode = 'manage' | 'select';

const POPULAR = new Set(['google-suite', 'quickbooks-online', 'slack']);

const CONSOLE_LABELS: Readonly<Record<ConnectorCard['setup']['kind'], string>> = {
  'one-click-oauth': 'Open provider console',
  'api-key': 'Open the key screen',
  'operator-portal': 'Open the provider portal',
};

/**
 * Maps a card onto the store's status vocabulary.
 *
 * Order matters, and so does what "unavailable" means. It is reserved for a
 * connector the tenant cannot set up at all. A connector that is configurable but
 * carries no button — every API-key provider, because no route accepts a pasted
 * key yet — reads as not connected, so the badge agrees with the "Setup required"
 * readiness text and the how-to beside it. Reading those as unavailable while
 * showing live setup steps contradicts itself.
 *
 * `manual` likewise means an import relationship exists, so it follows the
 * installation status rather than the provider's kind: a manual-only connector
 * with nothing imported is simply not connected yet.
 */
export function sharedStatus(card: ConnectorCard, mode: StoreMode): McpStoreStatus {
  if (card.status === 'connected-healthy') return 'connected';
  if (card.status === 'connected-degraded' || card.status === 'reauthorization-required') {
    return 'reconnect';
  }
  if (!card.canConfigure) return 'unavailable';
  if (mode === 'select') return 'not_connected';
  return card.isManualOnly && card.status === 'manual-import' ? 'manual' : 'not_connected';
}

/**
 * Projects the catalog setup block onto the shared store's disclosure shape.
 *
 * Returns undefined where there is nothing a reader can act on yet, so the store
 * renders no disclosure rather than an empty or misleading one.
 */
export function sharedSetup(card: ConnectorCard): McpStoreSetup | undefined {
  if (card.availability === 'coming-soon' || card.setup.steps.length === 0) return undefined;
  return {
    kind: card.setup.kind,
    estimatedMinutes: card.setup.estimatedMinutes,
    steps: card.setup.steps,
    consoleHref: card.setup.consoleUrl ?? null,
    consoleLabel: CONSOLE_LABELS[card.setup.kind],
    documentationHref: card.setup.documentationUrl ?? null,
  };
}

/** Builds the tenant-safe store entry for one connector card. */
export function sharedEntry(card: ConnectorCard, mode: StoreMode): McpStoreEntry {
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
    setup: mode === 'manage' ? sharedSetup(card) : undefined,
  };
}
