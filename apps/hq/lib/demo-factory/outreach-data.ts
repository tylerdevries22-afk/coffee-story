/**
 * Which demos have an outreach draft, day by day, and what an export needs.
 *
 * Drafts are derived, never stored: a day's drafts are whatever that UTC
 * day's demos yield now, so an export is a read that can be repeated, and a
 * corrected builder name or address reaches every draft at once. A day is the
 * factory's own rhythm -- one batch a day -- and a demo lives fourteen days,
 * so the window is the last fourteen.
 */
import type { DemoFactoryDb } from './console-data';
import { demoLinkPath, demoLinkSecret } from './link';
import {
  oneLine, outreachDraft, type OutreachDraft, type OutreachSender, type OutreachSite, type OutreachSkip,
} from './outreach-draft';

type Env = Readonly<Record<string, string | undefined>>;

export const OUTREACH_DAYS = 14;
const DAY_MS = 86_400_000;

export function outreachSender(env: Env = process.env): OutreachSender | null {
  const name = oneLine(env.DEMO_BUILDER_NAME, 80);
  const postalAddress = oneLine(env.DEMO_BUILDER_POSTAL_ADDRESS, 200);
  return name && postalAddress ? { name, postalAddress } : null;
}

/**
 * The console's public address, which a link in an email must use: the one
 * the invitation emails use too, https only, and never a preview deployment,
 * whose links stop working when the preview does.
 */
export function outreachOrigin(env: Env = process.env): string | null {
  const configured = env.NEXT_PUBLIC_HQ_URL?.trim();
  if (!configured) return null;
  try {
    const url = new URL(configured);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export type OutreachReadiness = {
  readonly sender: OutreachSender | null;
  readonly origin: string | null;
  readonly linkSecret: string | null;
  /** The settings still missing, by name, for the console to list. Never their values. */
  readonly missing: readonly string[];
};

export function outreachReadiness(env: Env = process.env): OutreachReadiness {
  const sender = outreachSender(env);
  const origin = outreachOrigin(env);
  const linkSecret = demoLinkSecret(env);
  const missing = [
    ...(oneLine(env.DEMO_BUILDER_NAME, 80) ? [] : ['DEMO_BUILDER_NAME']),
    ...(oneLine(env.DEMO_BUILDER_POSTAL_ADDRESS, 200) ? [] : ['DEMO_BUILDER_POSTAL_ADDRESS']),
    ...(origin ? [] : ['NEXT_PUBLIC_HQ_URL']),
    ...(linkSecret ? [] : ['DEMO_LINK_SECRET']),
  ];
  return { sender, origin, linkSecret, missing };
}

function dayStart(day: string): number {
  return Date.parse(`${day}T00:00:00.000Z`);
}

/** `day` when it is a real UTC date within the window, else null. */
export function outreachDay(value: unknown, now = new Date()): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const start = dayStart(value);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== value) return null;
  const age = (dayStart(now.toISOString().slice(0, 10)) - start) / DAY_MS;
  return age >= 0 && age < OUTREACH_DAYS ? value : null;
}

// The recipient and the menu's source are read out of the pack by path, so
// a day's worth of drafts never pulls a day's worth of packs over the wire.
const SITE_COLUMNS = 'id,business_name,country_code,state,expires_at,created_at,'
  + 'email:pack->brand->business->>email,menu_source:pack->>menuSource';
/** A hundred a day is the plan; this is the ceiling one read will carry. */
const MAX_SITES = 2_000;

type Row = Readonly<Record<string, unknown>>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function outreachSiteFrom(row: Row): OutreachSite {
  return {
    id: text(row.id),
    businessName: text(row.business_name),
    email: typeof row.email === 'string' ? row.email : null,
    countryCode: typeof row.country_code === 'string' ? row.country_code : null,
    state: text(row.state),
    expiresAt: text(row.expires_at),
    createdAt: text(row.created_at),
    menuFromWebsite: row.menu_source === 'website',
  };
}

function record(value: unknown): Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Row : {};
}

/** The same site from a row that carries the whole pack, as the preview page reads it. */
export function outreachSiteFromPack(row: Row): OutreachSite {
  const pack = record(row.pack);
  const business = record(record(pack.brand).business);
  return outreachSiteFrom({ ...row, email: business.email, menu_source: pack.menuSource });
}

/** Demos created from the start of `fromDay` up to, not including, the start of the day after `toDay`. */
export async function loadOutreachSites(db: DemoFactoryDb, fromDay: string, toDay: string): Promise<OutreachSite[]> {
  const result = await db.from('platform_demo_sites').select(SITE_COLUMNS)
    .gte('created_at', new Date(dayStart(fromDay)).toISOString())
    .lt('created_at', new Date(dayStart(toDay) + DAY_MS).toISOString())
    .order('created_at', { ascending: true }).limit(MAX_SITES);
  if (result.error) throw result.error;
  const rows: unknown[] = Array.isArray(result.data) ? result.data : [];
  return rows.filter((row): row is Row => typeof row === 'object' && row !== null)
    .map(outreachSiteFrom).filter((site) => site.id !== '');
}

export type OutreachBatch = {
  readonly drafts: readonly OutreachDraft[];
  readonly skipped: Readonly<Record<OutreachSkip, number>>;
};

/** Every draft the sites yield, and how many yielded none, by reason. */
export function outreachDrafts(
  sites: readonly OutreachSite[], sender: OutreachSender, origin: string, linkSecret: string, now = new Date(),
): OutreachBatch {
  const drafts: OutreachDraft[] = [];
  const skipped: Record<OutreachSkip, number> = { not_ready: 0, outside_us: 0, no_email: 0, expiring: 0 };
  for (const site of sites) {
    const decision = outreachDraft(site, sender, `${origin}${demoLinkPath(linkSecret, site.id)}`, now);
    if (decision.ok) drafts.push(decision.draft);
    else skipped[decision.reason] += 1;
  }
  return { drafts, skipped };
}
