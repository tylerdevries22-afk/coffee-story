import type {
  BoardTicketRow,
  FulfillmentType,
  OrderChannel,
  OrderStatus,
} from '@platform/schema';

import type { BoardConfig } from './board-config';
import { tierBySlug, type BoardTier } from './board-tiers';

export function provenanceLabel(channel: OrderChannel, fulfillment: FulfillmentType): string {
  switch (fulfillment) {
    case 'delivery': return 'for delivery';
    case 'curbside': return 'for curbside';
    case 'catering': return 'for catering';
    case 'pickup': break;
  }
  switch (channel) {
    case 'kiosk': return 'via kiosk';
    case 'pos': return 'via point of sale';
    case 'web': return 'via web';
    case 'app': return 'via the app';
  }
}

export type BoardEntry = {
  id: string;
  callout: string;
  position: number | null;
  ready: boolean;
  status: OrderStatus;
  name: string;
  tier: BoardTier | null;
  provenance: string | null;
  arrived: boolean;
};

export function ticketCallout(
  dailyNumber: number | null | undefined,
  guestLabel: string | null | undefined,
): string {
  if (dailyNumber !== null && dailyNumber !== undefined) return String(dailyNumber);
  return guestLabel?.trim() || 'Guest';
}

export type QueueMember = {
  id: string;
  status: OrderStatus;
  daily_number: number | null;
  updated_at: string;
};

function queueOrder(a: QueueMember, b: QueueMember): number {
  const aReady = a.status === 'ready';
  const bReady = b.status === 'ready';
  if (aReady !== bReady) return aReady ? -1 : 1;
  if (aReady && bReady) {
    const byWait = a.updated_at.localeCompare(b.updated_at);
    if (byWait !== 0) return byWait;
  }
  return (a.daily_number ?? 0) - (b.daily_number ?? 0);
}

export function queuePositions(
  members: readonly QueueMember[],
): Map<string, number | null> {
  const positions = new Map<string, number | null>();
  let place = 0;
  for (const member of [...members].sort(queueOrder)) {
    if (member.status === 'ready') {
      positions.set(member.id, null);
      continue;
    }
    place += 1;
    positions.set(member.id, place);
  }
  return positions;
}

export function displayName(label: string | null | undefined, max = 18): string {
  const name = (label ?? '').trim();
  if (name.length <= max) return name;
  return `${name.slice(0, max - 1).trimEnd()}…`;
}

export function toEntry(
  ticket: BoardTicketRow,
  config: BoardConfig,
  position: number | null,
): BoardEntry {
  return {
    id: ticket.id,
    callout: ticketCallout(ticket.daily_number, ticket.guest_label),
    position,
    ready: ticket.status === 'ready',
    status: ticket.status,
    name: displayName(ticket.guest_label),
    tier: config.showGuestStatus ? tierBySlug(ticket.loyalty_tier, config.ladder) : null,
    provenance: config.showChannel
      ? provenanceLabel(ticket.channel, ticket.fulfillment_type)
      : null,
    arrived: ticket.arrived_at !== null,
  };
}

export type BoardQueue = {
  entries: BoardEntry[];
  overflow: number;
};

export function boardQueue(
  tickets: readonly BoardTicketRow[],
  config: BoardConfig,
): BoardQueue {
  const positions = queuePositions(tickets);
  const ordered = [...tickets].sort(queueOrder);
  const entries = ordered.map((ticket) =>
    toEntry(ticket, config, positions.get(ticket.id) ?? null));

  if (config.maxLines <= 0 || entries.length <= config.maxLines) {
    return { entries, overflow: 0 };
  }
  const readyCount = entries.filter((entry) => entry.ready).length;
  const limit = Math.max(config.maxLines, readyCount);
  return { entries: entries.slice(0, limit), overflow: entries.length - limit };
}
