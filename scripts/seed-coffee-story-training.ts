import { createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

import {
  liftTrainingManifest,
  TRAINING_TRACK_ORDER,
  trainingTrackArtworkSvg,
  withTrainingArtwork,
  type TrainingArtworkUrls,
  type TrainingTrackKey,
} from '../packages/domain/src';
import { cafeTrainingManifest } from '../packages/domain/src/training-baseline';
import {
  normalizeTrainingProfile,
  prepareTrainingRelease,
  TRAINING_PIPELINE_VERSION,
  validateTrainingManifest,
} from '../apps/hq/lib/training-bootstrap';

import { registerStorageAsset } from './storage-registry.js';

const DATABASE_TIMEOUT_MS = 15_000;

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timeout = AbortSignal.timeout(DATABASE_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const response = await fetch(input, { ...init, signal });
      if (response.status < 500 && response.status !== 429) return response;
      lastError = new Error(`Supabase returned ${response.status}`);
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Supabase request failed');
}

async function trackArtworkBytes(trackKey: TrainingTrackKey): Promise<Buffer> {
  return sharp(Buffer.from(trainingTrackArtworkSvg(trackKey))).webp({ quality: 92 }).toBuffer();
}

async function syncTrackArtwork(
  db: SupabaseClient,
  publicUrl: string,
  brandId: string,
): Promise<TrainingArtworkUrls> {
  const entries = await Promise.all(TRAINING_TRACK_ORDER.map(async (trackKey) => {
    const bytes = await trackArtworkBytes(trackKey);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const directory = `${brandId}/training-module/${trackKey}`;
    const filename = `${checksum}.webp`;
    const objectPath = `${directory}/${filename}`;
    const existing = await db.storage.from('training-media').list(directory, { limit: 1, search: filename });
    if (existing.error) throw new Error(`Could not inspect ${trackKey} artwork: ${existing.error.message}`);
    if (!(existing.data ?? []).some((object) => object.name === filename)) {
      const upload = await db.storage.from('training-media').upload(objectPath, bytes, {
        contentType: 'image/webp', cacheControl: '31536000', upsert: false,
      });
      if (upload.error) {
        const verified = await db.storage.from('training-media').list(directory, { limit: 1, search: filename });
        if (verified.error || !(verified.data ?? []).some((object) => object.name === filename)) {
          throw new Error(`Could not upload ${trackKey} artwork: ${upload.error.message}`);
        }
      }
    }
    // Register it, or seeding leaves the platform unreleasable -- the
    // readiness head raises on any governed object with no registry row.
    await registerStorageAsset(db, {
      brandId, bucketId: 'training-media', objectPath, sourceKey: trackKey,
      originalFilename: `${trackKey}.webp`, assetKind: 'training_media',
      visibility: 'public', sourceType: 'training_module',
      mimeType: 'image/webp', byteSize: bytes.length, checksumSha256: checksum,
    });

    const url = `${publicUrl.replace(/\/$/, '')}/storage/v1/object/public/training-media/${objectPath}`;
    return [trackKey, url] as const;
  }));
  return Object.fromEntries(entries) as TrainingArtworkUrls;
}

function releaseHasArtwork(manifest: unknown, urls: TrainingArtworkUrls): boolean {
  // Lifted rather than shape-checked: a release seeded before schema 3 still
  // has the right artwork, and reseeding it would retire a live release for
  // nothing.
  const lifted = liftTrainingManifest(manifest);
  if (!lifted) return false;
  return TRAINING_TRACK_ORDER.every((slug) => lifted.tracks.some((track) =>
    track.slug === slug && track.icon.url === urls[slug]));
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: resilientFetch },
  });
  const brandName = process.argv.includes('--brand') ? process.argv[process.argv.indexOf('--brand') + 1] : 'Coffee Story';
  if (!brandName) throw new Error('A brand name is required.');
  const brand = await db.from('brands').select('id, name').ilike('name', brandName).limit(1).maybeSingle<{ id: string; name: string }>();
  if (brand.error || !brand.data) throw new Error('Coffee Story brand was not found.');

  const profile = normalizeTrainingProfile({
    businessName: brand.data.name,
    industry: 'Specialty coffee shop and café',
    locale: 'en-US',
    templateKey: 'coffee-story',
    templateVersion: 2,
    products: ['Espresso', 'Tea', 'Pastries'],
  });
  const artworkUrls = await syncTrackArtwork(db, url, brand.data.id);
  const manifest = withTrainingArtwork(cafeTrainingManifest(profile), artworkUrls);
  const issues = validateTrainingManifest(manifest);
  if (issues.length > 0) throw new Error(`Baseline curriculum is invalid: ${issues.join('; ')}`);
  const prepared = prepareTrainingRelease(manifest);

  const template = await db.from('training_templates').upsert({
    template_key: 'coffee-story', version: profile.templateVersion, industry: profile.industry, locale: profile.locale,
    manifest: prepared.publicManifest, status: 'published',
  }, { onConflict: 'template_key,version' }).select('id').single<{ id: string }>();
  if (template.error) throw new Error(`Template seed failed: ${template.error.message}`);

  // Keep the reusable franchise template present even when a prior v2 release
  // means the tenant itself needs no new release row.
  const existing = await db.from('training_releases').select('id, manifest').eq('brand_id', brand.data.id).eq('status', 'published').maybeSingle<{ id: string; manifest: unknown }>();
  if (!existing.error && releaseHasArtwork(existing.data?.manifest, artworkUrls)) {
    process.stdout.write(JSON.stringify({ status: 'already_seeded', releaseId: existing.data?.id, templateId: template.data.id }) + '\n');
    return;
  }

  const fingerprint = createHash('sha256').update(JSON.stringify({ profile, artworkUrls, artworkVersion: 1 })).digest('hex');
  const runId = randomUUID();
  const run = await db.from('training_bootstrap_runs').upsert({
    id: runId, brand_id: brand.data.id, profile_fingerprint: fingerprint,
    pipeline_version: TRAINING_PIPELINE_VERSION, trigger_kind: 'manual', status: 'published',
    stage: 'complete', progress: 100, finished_at: new Date().toISOString(),
  }, { onConflict: 'brand_id,profile_fingerprint,pipeline_version' }).select('id').single<{ id: string }>();
  if (run.error || !run.data) throw new Error(`Baseline run seed failed: ${run.error?.message ?? 'no run id returned'}`);

  const release = await db.rpc('publish_training_release', {
    target_brand: brand.data.id, target_run: run.data.id,
    release_manifest: prepared.publicManifest, release_answer_key: prepared.answerKey,
  });
  if (release.error) throw new Error(`Baseline release seed failed: ${release.error.message}`);
  process.stdout.write(JSON.stringify({ status: 'seeded', brandId: brand.data.id, templateId: template.data.id, releaseId: release.data }) + '\n');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Training baseline seed failed.';
  process.stderr.write(`${JSON.stringify({ error: { code: 'training_seed_failed', message } })}\n`);
  process.exitCode = 1;
});
