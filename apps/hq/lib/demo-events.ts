/**
 * What POST /d/events does with a screen-view report, apart from Next so it
 * can be tested the way demo-entry.ts and demo-pack-response.ts are.
 *
 * Same gate as every other `/d/` route: the httpOnly cookie set by
 * `/d/[token]`, resolved through demo-site.ts's own site lookup -- never a
 * second token scheme. Anonymous and demo-scoped: nothing this accepts,
 * stores or returns can identify the visitor, only which of a live demo's
 * screens they opened, and when.
 *
 * Rate limiting is two separate budgets, both from the shared limiter: a
 * per-client one, cheap enough to check before this file is even reached
 * (see the route), and a per-site one checked here once the cookie has
 * resolved to a site, so one demo cannot be flooded from many clients at
 * once. Both flags arrive as deps rather than this module calling
 * `rateLimited` itself, so a test controls them without touching the
 * limiter's shared module state.
 */
import type { DemoDb } from './demo-site';
import { readySiteId } from './demo-site';
import { log } from './log';

/** Mirrors packages/analytics's own bound: short, lowercase, identifier-shaped. */
const SCREEN_KEY = /^[a-z][a-z0-9_]{0,63}$/;

/** The only event this endpoint accepts -- see ANALYTICS_EVENT_NAMES in packages/analytics. */
const EVENT_NAME = 'screen.viewed';

export type DemoEventOutcome = 'accepted' | 'invalid' | 'not_found' | 'rate_limited' | 'unavailable';

export type DemoEventDeps = {
  readonly db: DemoDb | null;
  readonly clientLimited: boolean;
  readonly siteLimited: (siteId: string) => boolean;
  readonly now?: Date;
};

/** The screen key a body carries, or null when it is not exactly one accepted event. */
export function demoScreenFrom(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = body as { readonly event?: unknown; readonly screen?: unknown };
  if (value.event !== EVENT_NAME) return null;
  return typeof value.screen === 'string' && SCREEN_KEY.test(value.screen) ? value.screen : null;
}

/**
 * Records one screen view against the demo named by the cookie, or explains
 * why it did not. A database failure -- from the site lookup or the insert --
 * is left to throw, exactly like demo-pack-response.ts, so the route's own
 * catch is the one place that logs and answers 503.
 */
export async function recordDemoScreenView(
  token: string,
  body: unknown,
  deps: DemoEventDeps,
): Promise<DemoEventOutcome> {
  if (deps.clientLimited) return 'rate_limited';
  const screen = demoScreenFrom(body);
  if (!screen) return 'invalid';
  if (!deps.db) return 'unavailable';
  const siteId = await readySiteId(deps.db, token, deps.now ?? new Date());
  if (!siteId) return 'not_found';
  if (deps.siteLimited(siteId)) return 'rate_limited';
  const { error } = await deps.db.from('platform_demo_events').insert({ site_id: siteId, screen });
  if (error) throw new Error('Demo event insert failed.');
  log.info('demo.screen_viewed', { siteId });
  return 'accepted';
}
