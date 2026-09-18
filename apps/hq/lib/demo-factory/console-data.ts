/**
 * What the demo factory console reads: the brakes, recent batches with what
 * became of each business and what it cost, and spend per day.
 *
 * Service-role reads, made only after the page has checked for a platform
 * admin. Every row is mapped defensively -- a bigint can arrive as a string
 * and a missing column as undefined -- so a schema drift renders as zeros and
 * dashes, not as a crashed console.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type DemoFactoryDb = Pick<SupabaseClient, 'rpc' | 'from'>;

export type DemoFactorySettings = {
  readonly enabled: boolean;
  readonly dailyLimit: number;
  readonly dailyBudgetMicrousd: number;
};

export type DemoBatchState = 'running' | 'done' | 'stopped';

export type DemoBatchSummary = {
  readonly id: string;
  readonly query: string;
  readonly state: DemoBatchState;
  readonly requested: number;
  readonly found: number;
  readonly queued: number;
  readonly working: number;
  readonly built: number;
  readonly skipped: number;
  readonly failed: number;
  readonly unitEstimateMicrousd: number;
  readonly costMicrousd: number;
  readonly createdAt: string;
};

export type DemoDailyCost = {
  readonly day: string;
  readonly provider: string;
  readonly sku: string;
  readonly model: string | null;
  readonly quantity: number;
  readonly costMicrousd: number;
};

export type DemoConsole = {
  readonly settings: DemoFactorySettings;
  readonly batches: readonly DemoBatchSummary[];
  readonly daily: readonly DemoDailyCost[];
};

export type DemoFactoryReadiness = {
  readonly placesKey: boolean;
  readonly openAiKey: boolean;
  readonly builderName: boolean;
};

type Row = Readonly<Record<string, unknown>>;

function count(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function label(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function rows(data: unknown): Row[] {
  return Array.isArray(data) ? data.filter((row): row is Row => typeof row === 'object' && row !== null) : [];
}

const OFF: DemoFactorySettings = { enabled: false, dailyLimit: 0, dailyBudgetMicrousd: 0 };

export function settingsFrom(row: unknown): DemoFactorySettings {
  if (typeof row !== 'object' || row === null) return OFF;
  const value = row as Row;
  return {
    enabled: value.enabled === true,
    dailyLimit: count(value.daily_limit),
    dailyBudgetMicrousd: count(value.daily_budget_microusd),
  };
}

export function batchFrom(row: Row): DemoBatchSummary {
  const state = row.state === 'done' || row.state === 'stopped' ? row.state : 'running';
  return {
    id: label(row.id),
    query: label(row.query),
    state,
    requested: count(row.requested),
    found: count(row.found),
    queued: count(row.queued),
    working: count(row.working),
    built: count(row.built),
    skipped: count(row.skipped),
    failed: count(row.failed),
    unitEstimateMicrousd: count(row.unit_estimate_microusd),
    costMicrousd: count(row.cost_microusd),
    createdAt: label(row.created_at),
  };
}

export function dailyFrom(row: Row): DemoDailyCost {
  return {
    day: label(row.day),
    provider: label(row.provider),
    sku: label(row.sku),
    model: typeof row.model === 'string' ? row.model : null,
    quantity: count(row.quantity),
    costMicrousd: count(row.cost_microusd),
  };
}

/** Whether each piece of configuration is present. Never the values themselves. */
export function demoFactoryReadiness(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DemoFactoryReadiness {
  return {
    placesKey: Boolean(env.GOOGLE_PLACES_API_KEY?.trim()),
    openAiKey: Boolean(env.OPENAI_API_KEY?.trim()),
    builderName: Boolean(env.DEMO_BUILDER_NAME?.trim()),
  };
}

export async function loadDemoConsole(db: DemoFactoryDb): Promise<DemoConsole> {
  const [settings, batches, daily] = await Promise.all([
    db.from('platform_demo_settings')
      .select('enabled,daily_limit,daily_budget_microusd').eq('singleton', true).maybeSingle(),
    db.rpc('platform_demo_batch_summaries', { p_limit: 20 }),
    db.rpc('platform_demo_daily_costs', { p_days: 14 }),
  ]);
  if (settings.error) throw settings.error;
  if (batches.error) throw batches.error;
  if (daily.error) throw daily.error;
  return {
    settings: settingsFrom(settings.data),
    batches: rows(batches.data).map(batchFrom).filter((batch) => batch.id !== ''),
    daily: rows(daily.data).map(dailyFrom),
  };
}
