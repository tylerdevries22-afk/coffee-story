import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveCalendarDetailTemplate, type CalendarCoreKind, type CalendarIconKey } from '@platform/domain';

import type { CalendarDetailSection, CalendarItem } from './presentation';

export type LiveCalendarRows = {
  categories: { id: string; core_kind: CalendarCoreKind; name: string; icon_key: CalendarIconKey; accent_color: string }[];
  entries: { id: string; category_id: string; title: string; summary: string; status: string; starts_at: string; ends_at: string; timezone: string; location_id: string | null; project_key: string | null; detail: unknown }[];
  shifts: { id: string; starts_at: string; ends_at: string; location_id: string; brand_user_id: string; note: string }[];
  orders: { id: string; scheduled_for: string | null; location_id: string; status: string; fulfillment_type: string; note: string }[];
  locations: { id: string; name: string; timezone: string | null }[];
};

function dateToken(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  }).format(date);
}

function dayKey(timestamp: string, now: Date, timeZone: string): string {
  const target = dateToken(new Date(timestamp), timeZone);
  const offset = Array.from({ length: 8 }, (_, index) => index).find((index) => (
    dateToken(new Date(now.getTime() + index * 86_400_000), timeZone) === target
  ));
  return offset === 0 ? 'today' : offset === 1 ? 'tomorrow' : `day-${offset ?? -1}`;
}

function timeLabel(timestamp: string, timeZone: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
}

function initials(id: string): string {
  return id.replaceAll('-', '').slice(0, 2).toUpperCase();
}

export function calendarItemsFromRows(rows: LiveCalendarRows, now: Date): CalendarItem[] {
  const categories = new Map(rows.categories.map((category) => [category.id, category]));
  const locations = new Map(rows.locations.map((location) => [location.id, location]));
  const entries = rows.entries.flatMap<CalendarItem>((entry) => {
    const category = categories.get(entry.category_id);
    if (!category) return [];
    const location = entry.location_id ? locations.get(entry.location_id) : null;
    const timeZone = entry.timezone || location?.timezone || 'UTC';
    return [{
      id: entry.id,
      category: category.core_kind,
      categoryOverride: { label: category.name, iconKey: category.icon_key, accentColor: category.accent_color },
      title: entry.title,
      summary: entry.summary,
      date: dayKey(entry.starts_at, now, timeZone),
      startTime: timeLabel(entry.starts_at, timeZone),
      endTime: timeLabel(entry.ends_at, timeZone),
      startsAt: entry.starts_at,
      detailTemplate: resolveCalendarDetailTemplate(category.core_kind),
      location: location?.name ?? (entry.location_id ? 'Tenant location' : 'All locations'),
      project: entry.project_key ?? 'General',
      status: entry.status.replaceAll('_', ' '),
      assignees: [],
      sections: calendarDetailSections(entry.detail, category.name),
      primaryAction: category.core_kind === 'training' ? 'Start training' : 'Open item',
    }];
  });
  const shifts = rows.shifts.map<CalendarItem>((shift) => {
    const location = locations.get(shift.location_id);
    const timeZone = location?.timezone || 'UTC';
    return {
    id: `shift-${shift.id}`, category: 'scheduled_shift', title: 'Scheduled shift', summary: shift.note || 'Your scheduled work period.',
    date: dayKey(shift.starts_at, now, timeZone), startTime: timeLabel(shift.starts_at, timeZone), endTime: timeLabel(shift.ends_at, timeZone),
    startsAt: shift.starts_at, detailTemplate: 'shift', location: location?.name ?? 'Tenant location', project: 'Workforce', status: 'scheduled',
    assignees: [{ id: shift.brand_user_id, name: 'Assigned team member', initials: initials(shift.brand_user_id) }],
    sections: [{ title: 'Shift details', rows: [{ label: 'Note', value: shift.note || 'No note' }] }], primaryAction: 'View shift',
  }; });
  const orders = rows.orders.flatMap<CalendarItem>((order) => {
    if (!order.scheduled_for) return [];
    const end = new Date(new Date(order.scheduled_for).getTime() + 30 * 60_000).toISOString();
    const location = locations.get(order.location_id);
    const timeZone = location?.timezone || 'UTC';
    return [{
      id: `order-${order.id}`, category: 'order', detailTemplate: 'order', title: `Scheduled order ${order.id.slice(0, 6).toUpperCase()}`,
      summary: order.note || 'Prepare this order for its scheduled fulfillment window.', date: dayKey(order.scheduled_for, now, timeZone),
      startTime: timeLabel(order.scheduled_for, timeZone), endTime: timeLabel(end, timeZone), startsAt: order.scheduled_for, location: location?.name ?? 'Tenant location',
      project: 'Orders', status: order.status.replaceAll('_', ' '), assignees: [],
      sections: [{ title: 'Fulfillment', rows: [{ label: 'Method', value: order.fulfillment_type }] }], primaryAction: 'View order',
    }];
  });
  return [...entries, ...shifts, ...orders].sort((left, right) => (
    Date.parse(left.startsAt ?? '') - Date.parse(right.startsAt ?? '')
  ));
}

function calendarDetailSections(detail: unknown, categoryName: string): CalendarDetailSection[] {
  if (!detail || typeof detail !== 'object') return fallbackSections(categoryName);
  const sections = (detail as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return fallbackSections(categoryName);
  const valid = sections.slice(0, 8).flatMap<CalendarDetailSection>((section) => {
    if (!section || typeof section !== 'object') return [];
    const source = section as { title?: unknown; rows?: unknown };
    if (typeof source.title !== 'string' || !Array.isArray(source.rows)) return [];
    const detailRows = source.rows.slice(0, 12).flatMap<{ label: string; value: string }>((row) => {
      if (!row || typeof row !== 'object') return [];
      const candidate = row as { label?: unknown; value?: unknown };
      return typeof candidate.label === 'string' && typeof candidate.value === 'string'
        ? [{ label: candidate.label.slice(0, 80), value: candidate.value.slice(0, 500) }]
        : [];
    });
    return detailRows.length > 0 ? [{ title: source.title.slice(0, 80), rows: detailRows }] : [];
  });
  return valid.length > 0 ? valid : fallbackSections(categoryName);
}

function fallbackSections(categoryName: string): CalendarDetailSection[] {
  return [{ title: 'Details', rows: [{ label: 'Category', value: categoryName }] }];
}

export async function loadLiveCalendarItems(db: SupabaseClient, brandId: string, now = new Date()): Promise<CalendarItem[]> {
  // A UTC envelope wider than the visible rail prevents a traveling device's
  // timezone from clipping the tenant/location calendar day at either edge.
  const start = new Date(now.getTime() - 36 * 60 * 60_000);
  const end = new Date(now.getTime() + 9 * 24 * 60 * 60_000);
  const range = { start: start.toISOString(), end: end.toISOString() };
  const [categories, entries, shifts, orders, locations] = await Promise.all([
    db.from('calendar_categories').select('id, core_kind, name, icon_key, accent_color').eq('brand_id', brandId).eq('is_active', true).returns<LiveCalendarRows['categories']>(),
    db.from('calendar_entries').select('id, category_id, title, summary, status, starts_at, ends_at, timezone, location_id, project_key, detail').eq('brand_id', brandId).lt('starts_at', range.end).gt('ends_at', range.start).returns<LiveCalendarRows['entries']>(),
    db.from('shifts').select('id, starts_at, ends_at, location_id, brand_user_id, note').eq('brand_id', brandId).lt('starts_at', range.end).gt('ends_at', range.start).returns<LiveCalendarRows['shifts']>(),
    db.from('orders').select('id, scheduled_for, location_id, status, fulfillment_type, note').eq('brand_id', brandId).not('scheduled_for', 'is', null).gte('scheduled_for', range.start).lt('scheduled_for', range.end).returns<LiveCalendarRows['orders']>(),
    db.from('locations').select('id, name, timezone').eq('brand_id', brandId).returns<LiveCalendarRows['locations']>(),
  ]);
  const failed = [categories, entries, shifts, orders, locations].find((result) => result.error);
  if (failed?.error) throw new Error(`Calendar could not be loaded: ${failed.error.message}`);
  return calendarItemsFromRows({
    categories: categories.data ?? [], entries: entries.data ?? [], shifts: shifts.data ?? [],
    orders: orders.data ?? [], locations: locations.data ?? [],
  }, now);
}
