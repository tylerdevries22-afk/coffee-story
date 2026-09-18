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

import { demoLinkSecret } from './link';
import { count } from './numeric';
import { originalityGateReady } from './originality';
import { NO_DEMO_EVENTS, siteEventCounts, type DemoSiteEvents } from './site-events';

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

/** A built demo as the console lists it: whether its prospect has looked is the point. */
export type DemoSiteSummary = {
  readonly id: string;
  readonly businessName: string;
  readonly state: string;
  readonly openCount: number;
  readonly lastOpenedAt: string | null;
  readonly expiresAt: string;
  /** Screens viewed inside the app itself, once opened -- see 20260918150000. */
  readonly screenViews: number;
  readonly lastViewedAt: string | null;
};

export type DemoConsole = {
  readonly settings: DemoFactorySettings;
  readonly batches: readonly DemoBatchSummary[];
  readonly daily: readonly DemoDailyCost[];
  readonly sites: readonly DemoSiteSummary[];
};

export type DemoFactoryReadiness = {
  readonly placesKey: boolean;
  readonly openAiKey: boolean;
  readonly builderName: boolean;
  readonly linkSecret: boolean;
  readonly originalityDenylist: boolean;
};

type Row = Readonly<Record<string, unknown>>;

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

export function siteSummaryFrom(row: Row, events: DemoSiteEvents = NO_DEMO_EVENTS): DemoSiteSummary {
  return {
    id: label(row.id),
    businessName: label(row.business_name),
    state: label(row.state),
    openCount: count(row.open_count),
    lastOpenedAt: typeof row.last_opened_at === 'string' ? row.last_opened_at : null,
    expiresAt: label(row.expires_at),
    screenViews: events.screenViews,
    lastViewedAt: events.lastViewedAt,
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
    linkSecret: demoLinkSecret(env) !== null,
    originalityDenylist: originalityGateReady(env),
  };
}

export async function loadDemoConsole(db: DemoFactoryDb): Promise<DemoConsole> {
  const [settings, batches, daily, sites] = await Promise.all([
    db.from('platform_demo_settings')
      .select('enabled,daily_limit,daily_budget_microusd').eq('singleton', true).maybeSingle(),
    db.rpc('platform_demo_batch_summaries', { p_limit: 20 }),
    db.rpc('platform_demo_daily_costs', { p_days: 14 }),
    db.from('platform_demo_sites')
      .select('id,business_name,state,open_count,last_opened_at,expires_at')
      .order('created_at', { ascending: false }).limit(25),
  ]);
  if (settings.error) throw settings.error;
  if (batches.error) throw batches.error;
  if (daily.error) throw daily.error;
  if (sites.error) throw sites.error;
  const siteRows = rows(sites.data).filter((row) => label(row.id) !== '');
  const events = await siteEventCounts(db, siteRows.map((row) => label(row.id)));
  return {
    settings: settingsFrom(settings.data),
    batches: rows(batches.data).map(batchFrom).filter((batch) => batch.id !== ''),
    daily: rows(daily.data).map(dailyFrom),
    sites: siteRows.map((row) => siteSummaryFrom(row, events.get(label(row.id)))),
  };
}
