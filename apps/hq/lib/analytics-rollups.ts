import type { AnalyticsSurface } from '@platform/analytics';
import type { SupabaseClient } from '@supabase/supabase-js';

import { serverClient } from './supabase-server';

export type AnalyticsRollup = Readonly<{
  day: string;
  surface: AnalyticsSurface;
  metricKey: string;
  eventCount: number;
  successCount: number;
  failureCount: number;
  durationP50Ms: number | null;
  durationP95Ms: number | null;
}>;

type AnalyticsRollupRow = {
  readonly day: string;
  readonly surface: AnalyticsSurface;
  readonly metric_key: string;
  readonly event_count: number | string;
  readonly success_count: number | string;
  readonly failure_count: number | string;
  readonly duration_p50_ms: number | null;
  readonly duration_p95_ms: number | null;
};

/** Converts PostgREST numeric values into the bounded dashboard contract. */
export function analyticsRollupsOf(rows: readonly AnalyticsRollupRow[]): readonly AnalyticsRollup[] {
  return rows.map((row) => Object.freeze({
    day: row.day,
    surface: row.surface,
    metricKey: row.metric_key,
    eventCount: Number(row.event_count),
    successCount: Number(row.success_count),
    failureCount: Number(row.failure_count),
    durationP50Ms: row.duration_p50_ms,
    durationP95Ms: row.duration_p95_ms,
  }));
}

/** Loads the last 30 days of tenant-scoped analytics summaries under RLS. */
export async function loadAnalyticsRollups(
  providedClient?: SupabaseClient | null,
): Promise<readonly AnalyticsRollup[]> {
  const client = providedClient === undefined ? await serverClient() : providedClient;
  if (!client) return [];
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 30);
  const result = await client.from('analytics_daily_rollups')
    .select('day, surface, metric_key, event_count, success_count, failure_count, duration_p50_ms, duration_p95_ms')
    .gte('day', from.toISOString().slice(0, 10))
    .order('day', { ascending: false })
    .limit(5_000)
    .returns<AnalyticsRollupRow[]>();
  if (result.error) return [];
  return analyticsRollupsOf(result.data ?? []);
}
