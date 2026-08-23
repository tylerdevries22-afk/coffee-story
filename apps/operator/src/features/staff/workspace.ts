import type { AppRole, OrderSource, PortalOrder, StaffClient } from '@platform/domain';

// Moved to `features/money.ts` so the client menu and the register share one
// formatter. Re-exported here because every staff call site already imports it
// from this module.
export { formatMoney } from '@platform/domain';

/**
 * Surface a workspace renders on. The owner workspace sits on the darker plum
 * and the staff workspace a step lighter, so the two read apart immediately;
 * every page opened from a More page inherits its role's tone so the workspace
 * stays one continuous surface.
 */
export function workspaceTone(role: AppRole): 'admin' | 'staff' {
  return role === 'admin' ? 'admin' : 'staff';
}

/**
 * Guest segments the workspace filters by.
 *
 * The last five were massage modalities -- Deep tissue, Sports, Prenatal,
 * Lymphatic, Trigger point -- rendered as filter chips above the guest
 * directory, where none of them matched a single guest: `data/demo.ts` had
 * already been rebranded and tags its guests Brew Club, Spanish latte, Boba,
 * Matcha, Cold brew and Turkish coffee. The chips now match the data, so every
 * one of them filters to something. The web portal's chips have to follow.
 */
export const CLIENT_TAGS = [
  'Regular',
  'New',
  'VIP',
  'Brew Club',
  'Spanish latte',
  'Boba',
  'Matcha',
  'Cold brew',
  'Turkish coffee',
] as const;

export type ClientTag = (typeof CLIENT_TAGS)[number];

export const CALENDAR_VIEWS = ['Agenda', 'Day', 'Week', 'Month'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export function formatClockTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
    .format(new Date(iso))
    .replace(' AM', 'am')
    .replace(' PM', 'pm');
}

export function orderMinutes(order: PortalOrder): number {
  const span = new Date(order.scheduledFor ?? order.placedAt).getTime()
    - new Date(order.placedAt).getTime();
  return Math.max(0, Math.round(span / 60_000));
}

export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Minutes of daylight between one order and the next.
 *
 * Mirrors the web agenda: the strip under a row reads either the room-reset
 * buffer the order carries or, when it has none, the plain open gap. Returns 0
 * when the orders touch or overlap, and for the last order of the day.
 */
export function openGapMinutes(
  order: PortalOrder,
  next: PortalOrder | undefined,
): number {
  if (!next) return 0;
  const gap = (new Date(next.placedAt).getTime()
    - new Date(order.scheduledFor ?? order.placedAt).getTime()) / 60_000;
  return gap > 0 ? Math.round(gap) : 0;
}

/**
 * The strip drawn between two tickets on the floor.
 *
 * This used to have a 'recovery' variant carrying the room-reset buffer an
 * appointment reserved after itself. A counter resets nothing between orders,
 * so a strip is now only ever the open gap.
 */
export type ScheduleStrip =
  | { kind: 'open'; minutes: number }
  | null;

export function scheduleStrip(
  order: PortalOrder,
  next: PortalOrder | undefined,
): ScheduleStrip {
  const gap = openGapMinutes(order, next);
  return gap > 0 ? { kind: 'open', minutes: gap } : null;
}

export function sourceLabel(source: OrderSource | undefined): string | null {
  if (!source) return null;
  if (source === 'staff') return 'Added by you';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

export function statusLabel(status: PortalOrder['status']): string {
  return status.replace('_', ' ');
}

/** Percentage change against the prior period; null when there is no baseline. */
export function deltaPercent(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function sameDay(iso: string, day: Date): boolean {
  return new Date(iso).toDateString() === day.toDateString();
}

export function ordersOn(
  orders: readonly PortalOrder[],
  day: Date,
): PortalOrder[] {
  return orders
    .filter((order) => sameDay(order.placedAt, day))
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt));
}

export function agendaTotalCents(orders: readonly PortalOrder[]): number {
  return orders.reduce((total, order) => total + order.subtotalCents, 0);
}

/** Search over name and email, then narrow by a single care tag. */
export function filterClients(
  clients: readonly StaffClient[],
  query: string,
  tag: ClientTag | null,
): StaffClient[] {
  const needle = query.trim().toLowerCase();
  return clients.filter((client) => {
    const matchesQuery = !needle
      || `${client.fullName} ${client.email}`.toLowerCase().includes(needle);
    const matchesTag = !tag || (client.tags ?? []).includes(tag);
    return matchesQuery && matchesTag;
  });
}

/** Days in `day`'s month, plus the weekday its first falls on. */
export function monthGrid(day: Date): { leading: number; days: number } {
  const first = new Date(day.getFullYear(), day.getMonth(), 1);
  const days = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
  return { leading: first.getDay(), days };
}

export function startOfWeek(day: Date): Date {
  const start = new Date(day);
  start.setDate(start.getDate() - start.getDay());
  start.setHours(0, 0, 0, 0);
  return start;
}

export function addDays(day: Date, count: number): Date {
  const next = new Date(day);
  next.setDate(next.getDate() + count);
  return next;
}
