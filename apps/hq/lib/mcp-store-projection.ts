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
  // Connected states are read before the configurability gate, so an operator
  // deactivating a provider never silently hides a live connection the tenant has.
  if (card.status === 'connected-degraded' || card.status === 'reauthorization-required') {
    return 'reconnect';
  }
  if (card.status === 'connected-healthy') {
    return hasScopeGap(card) ? 'reconnect' : 'connected';
  }
  if (!card.canConfigure) return 'unavailable';
  if (mode === 'select') return 'not_connected';
  return card.isManualOnly && card.status === 'manual-import' ? 'manual' : 'not_connected';
}

/**
 * True when the provider granted less than the connector advertises.
 *
 * A granular consent screen lets a user decline individual permissions, and the
 * installation then stores a narrower capability set while still reading healthy.
 * Without this the card would be green and silently never deliver what it lists,
 * with no way to widen the grant: re-consent is only reachable by connecting again.
 */
export function hasScopeGap(card: ConnectorCard): boolean {
  return card.isConnected
    && card.capabilityCount > 0
    && card.enabledCapabilityCount < card.capabilityCount;
}

/**
 * Projects the catalog setup block onto the shared store's disclosure shape.
 *
 * Returns undefined where there is nothing a reader can act on yet, so the store
 * renders no disclosure rather than an empty or misleading one.
 */
export function sharedSetup(card: ConnectorCard): McpStoreSetup | undefined {
  // A connector the tenant cannot set up must not teach setup. Without this, a
  // transient registry error renders every row as "Unavailable" beside a live
  // "Press Connect" walkthrough — the contradiction this projection exists to end.
  if (!card.canConfigure) return undefined;
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

/**
 * The readiness line, which must agree with the badge beside it.
 *
 * A card whose badge reads "Unavailable" must not report the installation's own
 * status one column to the left, and a partial grant should say so rather than
 * claim health.
 */
export function readinessLabel(card: ConnectorCard, mode: StoreMode): string {
  const status = sharedStatus(card, mode);
  if (status === 'unavailable') return card.statusLabel === 'Disabled' ? 'Disabled' : 'Unavailable';
  if (status === 'reconnect' && hasScopeGap(card)) {
    return `Connected with ${card.enabledCapabilityCount} of ${card.capabilityCount} capabilities`;
  }
  return card.statusLabel;
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
    readiness: readinessLabel(card, mode),
    popular: POPULAR.has(card.id),
    selectable: card.canConfigure,
    detailHref: `/integrations/${card.id}`,
    connectHref: card.connectHref,
    connectLabel: card.connectLabel ?? undefined,
    setup: mode === 'manage' ? sharedSetup(card) : undefined,
  };
}
