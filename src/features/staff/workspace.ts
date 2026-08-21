import type { AppRole, BookingSource, PortalAppointment, StaffClient } from '@/types/domain';

/**
 * Surface a workspace renders on. The owner workspace sits on the darker plum
 * and the staff workspace a step lighter, so the two read apart immediately;
 * every page opened from a More page inherits its role's tone so the workspace
 * stays one continuous surface.
 */
export function workspaceTone(role: AppRole): 'admin' | 'staff' {
  return role === 'admin' ? 'admin' : 'staff';
}

/** Care segments the workspace filters by, matching the web portal chips. */
export const CLIENT_TAGS = [
  'Regular',
  'New',
  'VIP',
  'Membership',
  'Deep tissue',
  'Sports',
  'Prenatal',
  'Lymphatic',
  'Trigger point',
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

export function appointmentMinutes(appointment: PortalAppointment): number {
  const span = new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime();
  return Math.max(0, Math.round(span / 60_000));
}

export function formatMoney(cents: number): string {
  const dollars = cents / 100;
  const whole = Number.isInteger(dollars);
  return `$${dollars.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
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
 * Minutes of daylight between one visit and the next.
 *
 * Mirrors the web agenda: the strip under a row reads either the room-reset
 * buffer the visit carries or, when it has none, the plain open gap. Returns 0
 * when the visits touch or overlap, and for the last visit of the day.
 */
export function openGapMinutes(
  appointment: PortalAppointment,
  next: PortalAppointment | undefined,
): number {
  if (!next) return 0;
  const gap = (new Date(next.startsAt).getTime() - new Date(appointment.endsAt).getTime()) / 60_000;
  return gap > 0 ? Math.round(gap) : 0;
}

export type ScheduleStrip =
  | { kind: 'recovery'; minutes: number }
  | { kind: 'open'; minutes: number }
  | null;

export function scheduleStrip(
  appointment: PortalAppointment,
  next: PortalAppointment | undefined,
): ScheduleStrip {
  if (appointment.recoveryMinutes && appointment.recoveryMinutes > 0) {
    return { kind: 'recovery', minutes: appointment.recoveryMinutes };
  }
  const gap = openGapMinutes(appointment, next);
  return gap > 0 ? { kind: 'open', minutes: gap } : null;
}

export function sourceLabel(source: BookingSource | undefined): string | null {
  if (!source) return null;
  if (source === 'staff') return 'Added by you';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

export function statusLabel(status: PortalAppointment['status']): string {
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

export function appointmentsOn(
  appointments: readonly PortalAppointment[],
  day: Date,
): PortalAppointment[] {
  return appointments
    .filter((appointment) => sameDay(appointment.startsAt, day))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function agendaTotalCents(appointments: readonly PortalAppointment[]): number {
  return appointments.reduce((total, appointment) => total + appointment.subtotalCents, 0);
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
