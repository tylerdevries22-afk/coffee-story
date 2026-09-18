/**
 * One queued business, built into a demo or set aside with a reason.
 *
 * Cheapest refusal first. A business that asked to be left alone, or already
 * has a live demo, costs nothing. Then the one billed Place Details call,
 * booked on the ledger the moment it succeeds. Then what needs its answer:
 * still operating, and in the US -- the outreach this serves is geo-fenced
 * there. Then the website's brand kit, when there is one and a reader is
 * configured, and last the pack and the site row, whose link is derived from
 * its id so that only its hash is stored.
 */
import { PlacesError, type PlaceDetails } from '@platform/engine';

import { removeDemoMedia, type DemoDb } from '../demo-site';
import { log } from '../log';
import { placeToDraft } from '../place-to-draft';
import type { DemoBrandKit } from './kit';
import { recordDemoCost, type DemoCostOwner } from './ledger';
import { demoLinkHash } from './link';
import { checkPackOriginality } from './originality';
import { buildDemoPack } from './pack-builder';
import type { DemoCostLine } from './prices';

export type ClaimedDemoJob = {
  readonly id: string;
  readonly batchId: string;
  readonly placeId: string;
  readonly attempt: number;
  readonly createdBy: string | null;
};

/** Reads a website into a brand kit, uploading media under `siteId` and booking each billed call. */
export type DemoKitReader = (input: {
  readonly website: string;
  readonly siteId: string;
  /** The listing's name, which the website's own text is read against. */
  readonly businessName: string;
  readonly book: (line: DemoCostLine) => Promise<void>;
  readonly signal: AbortSignal;
}) => Promise<DemoBrandKit | null>;

export type DemoJobDeps = {
  readonly db: DemoDb;
  readonly details: (placeId: string, signal: AbortSignal) => Promise<PlaceDetails>;
  readonly readKit: DemoKitReader | null;
  readonly linkSecret: string;
  readonly newSiteId: () => string;
  /** Names no generated pack may show; empty only when the caller already refused to run without it. */
  readonly originalityDenylist: readonly string[];
};

export type DemoJobOutcome =
  | { readonly state: 'built'; readonly siteId: string }
  | { readonly state: 'skipped' | 'failed' | 'queued'; readonly outcome: string };

async function alreadyCovered(db: DemoDb, placeId: string): Promise<'suppressed' | 'already_live' | null> {
  const [suppressed, live] = await Promise.all([
    db.from('platform_demo_suppressions').select('kind').eq('kind', 'google_place').eq('value', placeId).limit(1),
    db.from('platform_demo_sites').select('id').eq('google_place_id', placeId).in('state', ['building', 'ready']).limit(1),
  ]);
  if (suppressed.error) throw suppressed.error;
  if (live.error) throw live.error;
  if ((suppressed.data ?? []).length > 0) return 'suppressed';
  return (live.data ?? []).length > 0 ? 'already_live' : null;
}

/** A Places failure as what to do with the job: retry what may pass, stop what cannot. */
function placesOutcome(error: unknown): DemoJobOutcome {
  if (!(error instanceof PlacesError)) return { state: 'queued', outcome: 'places_error' };
  if (error.code === 'not_found') return { state: 'skipped', outcome: 'place_not_found' };
  if (error.code === 'unconfigured') return { state: 'failed', outcome: 'places_unconfigured' };
  return { state: 'queued', outcome: error.code === 'over_quota' ? 'places_quota' : 'places_error' };
}

/** The site's host as the suppression list keys it: lowercase, without `www.`. */
export function websiteHost(website: string | null): string | null {
  if (!website) return null;
  try {
    const host = new URL(website).hostname.toLowerCase().replace(/^www\./, '');
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host) && host.length <= 253 ? host : null;
  } catch {
    return null;
  }
}

/** Nothing will point at images uploaded for a site that is never stored. */
async function discardMedia(db: DemoDb, siteId: string): Promise<void> {
  await removeDemoMedia(db, siteId).catch((error: unknown) => {
    log.error('demo_factory.orphan_media', { siteId }, error);
  });
}

async function readKit(deps: DemoJobDeps, owner: DemoCostOwner, listing: { website: string | null; name: string },
  siteId: string, signal: AbortSignal): Promise<DemoBrandKit | null> {
  const { website } = listing;
  if (!deps.readKit || !website) return null;
  try {
    return await deps.readKit({
      website, businessName: listing.name, siteId, signal,
      book: async (line) => { await recordDemoCost(deps.db, owner, line); },
    });
  } catch (error) {
    // A website that cannot be read still gets the demo its listing supports.
    log.warn('demo_factory.kit_failed', { jobId: owner.jobId }, error);
    return null;
  }
}

export async function buildDemoJob(job: ClaimedDemoJob, deps: DemoJobDeps, signal: AbortSignal): Promise<DemoJobOutcome> {
  const covered = await alreadyCovered(deps.db, job.placeId);
  if (covered) return { state: 'skipped', outcome: covered };
  const owner = { batchId: job.batchId, jobId: job.id };
  let place: PlaceDetails;
  try {
    place = await deps.details(job.placeId, signal);
  } catch (error) {
    return placesOutcome(error);
  }
  await recordDemoCost(deps.db, owner, { provider: 'google_places', sku: 'place_details_enterprise', quantity: 1 });
  if (place.businessStatus === 'CLOSED_PERMANENTLY' || place.businessStatus === 'CLOSED_TEMPORARILY') {
    return { state: 'skipped', outcome: 'closed' };
  }
  if (place.address.country?.toUpperCase() !== 'US') return { state: 'skipped', outcome: 'outside_us' };

  const draft = placeToDraft(place);
  const siteId = deps.newSiteId();
  const kit = await readKit(deps, owner, draft, siteId, signal);
  const built = buildDemoPack({ place, draft, kit });
  if (!built.ok) {
    if (kit) await discardMedia(deps.db, siteId);
    return { state: 'skipped', outcome: built.reason };
  }

  // Last check before anything is stored: the pack is fully assembled, kit
  // included, so this is the one place that sees exactly what a guest would.
  const originality = checkPackOriginality(draft.name, built.pack, deps.originalityDenylist);
  if (originality.hit) {
    log.warn('demo_factory.originality_hit', {
      jobId: owner.jobId,
      fields: originality.fields.map((field) => field.field),
      hits: originality.fields.reduce((total, field) => total + field.count, 0),
    });
    if (kit) await discardMedia(deps.db, siteId);
    return { state: 'skipped', outcome: 'originality' };
  }

  const inserted = await deps.db.from('platform_demo_sites').insert({
    id: siteId,
    token_hash: demoLinkHash(deps.linkSecret, siteId),
    google_place_id: job.placeId,
    business_name: draft.name,
    website_host: websiteHost(draft.website),
    industry_key: draft.industry.key,
    country_code: 'US',
    pack: built.pack,
    state: 'ready',
    created_by: job.createdBy,
  });
  if (!inserted.error) return { state: 'built', siteId };
  if (kit) await discardMedia(deps.db, siteId);
  const { code } = inserted.error;
  if (code === '23505') return { state: 'skipped', outcome: 'already_live' };
  if (code === '23514' && /asked not to be demoed/.test(inserted.error.message)) return { state: 'skipped', outcome: 'suppressed' };
  log.error('demo_factory.site_insert_failed', { jobId: job.id, code }, inserted.error);
  return code === '23514' ? { state: 'failed', outcome: 'invalid_pack' } : { state: 'queued', outcome: 'database' };
}
