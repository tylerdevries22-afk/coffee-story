/**
 * Reading, opening and removing one demo site, server side.
 *
 * Every call takes the raw link token and turns it into its SHA-256 here, so
 * the token never reaches the database and a malformed one never reaches it
 * at all. The client passed in is the service role: demo rows have no client
 * grants (20260918120000), and the checks that stand in for a session -- the
 * token, the state, the expiry -- are the ones made below.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { DEMO_MEDIA_NAME } from './demo-pack';
import { demoTokenHash, isDemoToken } from './demo-token';
import { log } from './log';

export type DemoSiteView =
  | {
    readonly state: 'ready';
    readonly id: string;
    readonly businessName: string;
    readonly expiresAt: string;
    readonly pack: unknown;
  }
  | { readonly state: 'expired'; readonly businessName: string }
  | { readonly state: 'gone' };

export type DemoDb = Pick<SupabaseClient, 'rpc' | 'from' | 'storage'>;

const BUCKET = 'demo-media';

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * What a stored row means right now. A ready row past its expiry reads as
 * expired before the sweep reaches it, so the window is exact rather than
 * "fourteen days, give or take the cron".
 */
export function siteView(row: unknown, now: Date): DemoSiteView {
  const source = record(row);
  const businessName = typeof source.business_name === 'string' && source.business_name.trim()
    ? source.business_name.trim()
    : 'This business';
  const expiresAt = typeof source.expires_at === 'string' ? source.expires_at : '';
  const expiry = Date.parse(expiresAt);
  const live = Number.isFinite(expiry) && expiry > now.getTime();
  if (source.state === 'ready' && live && typeof source.id === 'string') {
    return { state: 'ready', id: source.id, businessName, expiresAt, pack: source.pack };
  }
  if (source.state === 'expired' || (source.state === 'ready' && !live)) {
    return { state: 'expired', businessName };
  }
  return { state: 'gone' };
}

async function lookup(db: DemoDb, token: string, columns: string, now: Date): Promise<DemoSiteView> {
  if (!isDemoToken(token)) return { state: 'gone' };
  const { data, error } = await db.from('platform_demo_sites').select(columns)
    .eq('token_hash', demoTokenHash(token)).maybeSingle();
  if (error) throw new Error('Demo lookup failed.');
  return siteView(data, now);
}

/** The demo behind a link, pack included. */
export function viewDemoSite(db: DemoDb, token: string, now = new Date()): Promise<DemoSiteView> {
  return lookup(db, token, 'id,state,business_name,expires_at,pack', now);
}

/**
 * Counts an open. Only a ready, unexpired demo is counted, in one statement
 * on the database side; the answer is when that demo expires, or null when
 * the link opened nothing.
 */
export async function openDemoSite(db: DemoDb, token: string): Promise<string | null> {
  if (!isDemoToken(token)) return null;
  const { data, error } = await db.rpc('open_platform_demo_site', { p_token_hash: demoTokenHash(token) });
  if (error) throw new Error('Demo open failed.');
  const expiresAt = Array.isArray(data) ? record(data[0]).expires_at : undefined;
  return typeof expiresAt === 'string' ? expiresAt : null;
}

/**
 * Removes a demo at its business's request: the row is wiped and suppressed
 * by the database in one statement, then its images are deleted. Image
 * cleanup is best effort -- the business is already gone from every page, and
 * an orphaned object is logged for the retention sweep rather than failing
 * the request of someone asking to be forgotten.
 */
export async function removeDemoSite(db: DemoDb, token: string): Promise<boolean> {
  if (!isDemoToken(token)) return false;
  const { data, error } = await db.rpc('remove_platform_demo_site', { p_token_hash: demoTokenHash(token) });
  if (error) throw new Error('Demo removal failed.');
  const id = Array.isArray(data) ? record(data[0]).id : undefined;
  if (typeof id !== 'string') return false;
  try {
    await removeDemoMedia(db, id);
  } catch (cleanupError) {
    log.error('demo.media_removal_failed', { siteId: id }, cleanupError);
  }
  return true;
}

/**
 * Deletes every image in one demo's folder and returns how many went. Shared
 * by removal and by the expiry sweep, so both forget a business the same way.
 */
export async function removeDemoMedia(db: Pick<DemoDb, 'storage'>, siteId: string): Promise<number> {
  const bucket = db.storage.from(BUCKET);
  const listed = await bucket.list(siteId, { limit: 1000 });
  if (listed.error) throw listed.error;
  const paths = (listed.data ?? []).map((object) => `${siteId}/${object.name}`);
  if (paths.length === 0) return 0;
  const removed = await bucket.remove(paths);
  if (removed.error) throw removed.error;
  return paths.length;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};

/** One image of a live demo, or nothing -- never an image of another demo. */
export async function demoMedia(
  db: DemoDb,
  token: string,
  name: string,
  now = new Date(),
): Promise<{ readonly body: ArrayBuffer; readonly contentType: string } | null> {
  if (!DEMO_MEDIA_NAME.test(name)) return null;
  // No pack here: an image request needs the id and the state, not 500 KB.
  const site = await lookup(db, token, 'id,state,business_name,expires_at', now);
  if (site.state !== 'ready') return null;
  const { data, error } = await db.storage.from(BUCKET).download(`${site.id}/${name}`);
  if (error || !data) return null;
  const extension = name.slice(name.lastIndexOf('.') + 1);
  return { body: await data.arrayBuffer(), contentType: CONTENT_TYPES[extension] ?? 'application/octet-stream' };
}
