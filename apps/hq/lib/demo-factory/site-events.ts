/**
 * Per-site screen-view counts for the console list: one round trip for the
 * whole page of sites, through platform_demo_event_counts (20260918150000),
 * rather than one query per row.
 */
import type { DemoFactoryDb } from './console-data';
import { count } from './numeric';

export type DemoSiteEvents = Readonly<{ screenViews: number; lastViewedAt: string | null }>;

export const NO_DEMO_EVENTS: DemoSiteEvents = { screenViews: 0, lastViewedAt: null };

function eventsFrom(row: Readonly<Record<string, unknown>>): DemoSiteEvents {
  return {
    screenViews: count(row.screen_views),
    lastViewedAt: typeof row.last_viewed_at === 'string' ? row.last_viewed_at : null,
  };
}

/** One entry per site that has at least one event; a site with none is absent. */
export async function siteEventCounts(
  db: DemoFactoryDb,
  siteIds: readonly string[],
): Promise<ReadonlyMap<string, DemoSiteEvents>> {
  if (siteIds.length === 0) return new Map();
  const { data, error } = await db.rpc('platform_demo_event_counts', { p_site_ids: siteIds });
  if (error) throw error;
  const map = new Map<string, DemoSiteEvents>();
  for (const row of Array.isArray(data) ? data : []) {
    if (typeof row !== 'object' || row === null) continue;
    const siteId = (row as Record<string, unknown>).site_id;
    if (typeof siteId === 'string' && siteId) map.set(siteId, eventsFrom(row as Record<string, unknown>));
  }
  return map;
}
