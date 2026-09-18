import { createHash } from 'node:crypto';

import { CrawlBudget, PublicFetchError, fetchPublic, type Transport } from '../public-fetch';
import type { BrandAssetSink } from './asset-sink';
import { normalizeLogo, normalizeMenuPhoto, type LogoFlag, type PhotoFlag, type PhotoGrade } from './image-normalize';

/**
 * Downloads a brand kit's logo and photographs and normalises them.
 *
 * Every download goes through the hardened public fetch (lib/public-fetch)
 * on a budget of its own, so a site of enormous images costs a bounded
 * amount; each accepted image is normalised and written to the sink. One bad
 * image never sinks the rest: a failure is recorded in the manifest with its
 * reason, and so is every off-band grade, so a reviewer sees exactly what a
 * demo would ship and why.
 */
export const MAX_PHOTOS = 12;

/** About two full sets of maximum-size images would already be pathological. */
export const ASSET_LIMITS = { maxRequests: 30, maxBytes: 48 * 1_048_576, deadlineMs: 90_000 } as const;

export type StoredAsset = {
  readonly sourceUrl: string;
  readonly key: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly edge: number;
};

export type LogoEntry = (StoredAsset & { readonly flags: readonly LogoFlag[] }) | { readonly sourceUrl: string; readonly error: string };
export type PhotoEntry =
  | (StoredAsset & { readonly flags: readonly PhotoFlag[]; readonly grade: PhotoGrade })
  | { readonly sourceUrl: string; readonly error: string };

export type AssetManifest = {
  readonly logo: LogoEntry | null;
  readonly photos: readonly PhotoEntry[];
};

export type AssetSources = { readonly logoUrl: string | null; readonly imageUrls: readonly string[] };

export type CollectOptions = {
  readonly sink: BrandAssetSink;
  readonly budget?: CrawlBudget | undefined;
  readonly transport?: Transport | undefined;
  readonly maxPhotos?: number | undefined;
};

function reasonFor(error: unknown): string {
  // A decoder failure is the image's fault, not the network's.
  return error instanceof PublicFetchError ? error.code : 'undecodable';
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

type Fetched<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/**
 * Download and normalise one image. Failures of the image or its site are
 * returned; a sink failure is not caught anywhere here, because storage
 * being down is a reason to retry the step, not a fact about the image.
 */
async function prepare<T>(url: string, fetchOptions: Parameters<typeof fetchPublic>[2], normalize: (bytes: Buffer) => Promise<T>): Promise<Fetched<T>> {
  try {
    const fetched = await fetchPublic(url, 'image', fetchOptions);
    return { ok: true, value: await normalize(fetched.body) };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function collectBrandAssets(sources: AssetSources, options: CollectOptions): Promise<AssetManifest> {
  const fetchOptions = { budget: options.budget ?? new CrawlBudget(ASSET_LIMITS), transport: options.transport };
  let logo: LogoEntry | null = null;
  if (sources.logoUrl !== null) {
    const prepared = await prepare(sources.logoUrl, fetchOptions, (bytes) => normalizeLogo(bytes));
    if (prepared.ok) {
      const { bytes, edge, flags } = prepared.value;
      const digest = sha256(bytes);
      await options.sink.put({ key: 'logo.webp', bytes, contentType: 'image/webp', sha256: digest });
      logo = { sourceUrl: sources.logoUrl, key: 'logo.webp', byteLength: bytes.length, sha256: digest, edge, flags };
    } else {
      logo = { sourceUrl: sources.logoUrl, error: reasonFor(prepared.error) };
    }
  }

  const photos: PhotoEntry[] = [];
  const stored = new Set<string>();
  for (const sourceUrl of sources.imageUrls.slice(0, options.maxPhotos ?? MAX_PHOTOS)) {
    const prepared = await prepare(sourceUrl, fetchOptions, (bytes) => normalizeMenuPhoto(bytes));
    if (!prepared.ok) {
      photos.push({ sourceUrl, error: reasonFor(prepared.error) });
      // Nothing after a spent budget can succeed either.
      if (prepared.error instanceof PublicFetchError && prepared.error.code === 'budget_exhausted') break;
      continue;
    }
    const { bytes, edge, flags, grade } = prepared.value;
    const digest = sha256(bytes);
    // The same picture under two addresses is one asset.
    if (stored.has(digest)) continue;
    stored.add(digest);
    const key = `photos/${String(stored.size).padStart(2, '0')}-${digest.slice(0, 12)}.webp`;
    await options.sink.put({ key, bytes, contentType: 'image/webp', sha256: digest });
    photos.push({ sourceUrl, key, byteLength: bytes.length, sha256: digest, edge, flags, grade });
  }
  return { logo, photos };
}
