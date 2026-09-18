/**
 * What `/d/<token>` does with a link, apart from Next so it can be tested.
 *
 * A link is opened once, here: the open is counted, the token moves into an
 * httpOnly cookie, and the browser lands on `/d/view`. After that the token is
 * no longer in the address bar, so a screenshot, a shared URL or a Referer
 * header carries nothing that opens the demo -- and every page and image of
 * the demo can find it without a token in its path.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { DemoBuilder } from './demo-builder';
import { openDemoSite } from './demo-site';
import { isDemoToken } from './demo-token';
import { log } from './log';

export const DEMO_COOKIE = 'platform_demo';
export const DEMO_VIEW_PATH = '/d/view';

const HOUR = 3_600;
const FORTNIGHT = 14 * 24 * HOUR;

export type DemoCookie = {
  readonly name: string;
  readonly value: string;
  readonly options: {
    readonly httpOnly: true;
    readonly secure: boolean;
    readonly sameSite: 'lax';
    readonly path: '/';
    readonly maxAge: number;
  };
};

export type DemoEntry =
  | { readonly kind: 'opened'; readonly cookie: DemoCookie }
  | { readonly kind: 'unopened'; readonly cookie: DemoCookie }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'rate_limited' };

/**
 * The cookie lives exactly as long as the demo does, never past the 14-day
 * window. A link that opened nothing keeps it for an hour: long enough for
 * the view to say "expired" or "removed" instead of "open your email link".
 */
export function demoCookie(token: string, expiresAt: string | null, now: Date, secure: boolean): DemoCookie {
  const expiry = expiresAt === null ? Number.NaN : Date.parse(expiresAt);
  const remaining = Number.isFinite(expiry) ? Math.floor((expiry - now.getTime()) / 1000) : HOUR;
  return {
    name: DEMO_COOKIE,
    value: token,
    options: {
      httpOnly: true, secure, sameSite: 'lax', path: '/',
      maxAge: Math.max(60, Math.min(remaining, FORTNIGHT)),
    },
  };
}

export async function demoEntry(token: string, deps: {
  readonly db: Pick<SupabaseClient, 'rpc' | 'from' | 'storage'> | null;
  readonly builder: DemoBuilder | null;
  readonly limited: boolean;
  readonly now: Date;
  readonly secure: boolean;
}): Promise<DemoEntry> {
  if (deps.limited) return { kind: 'rate_limited' };
  // Shape first: a malformed link never costs a database round trip.
  if (!isDemoToken(token)) return { kind: 'invalid' };
  // No builder name, no demo: the page must always say who made it.
  if (!deps.db || !deps.builder) return { kind: 'unavailable' };
  try {
    const expiresAt = await openDemoSite(deps.db, token);
    return expiresAt === null
      ? { kind: 'unopened', cookie: demoCookie(token, null, deps.now, deps.secure) }
      : { kind: 'opened', cookie: demoCookie(token, expiresAt, deps.now, deps.secure) };
  } catch (error) {
    log.error('demo.open_failed', {}, error);
    return { kind: 'unavailable' };
  }
}
