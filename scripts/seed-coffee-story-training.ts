import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

import { coffeeStoryTrainingManifest } from '../packages/domain/src/training-baseline';
import {
  normalizeTrainingProfile,
  prepareTrainingRelease,
  TRAINING_PIPELINE_VERSION,
  validateTrainingManifest,
} from '../apps/hq/lib/training-bootstrap';

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  const brandName = process.argv.includes('--brand') ? process.argv[process.argv.indexOf('--brand') + 1] : 'Coffee Story';
  if (!brandName) throw new Error('A brand name is required.');
  const brand = await db.from('brands').select('id, name').ilike('name', brandName).limit(1).maybeSingle<{ id: string; name: string }>();
  if (brand.error || !brand.data) throw new Error('Coffee Story brand was not found.');

  const profile = normalizeTrainingProfile({
    businessName: brand.data.name,
    industry: 'Specialty coffee shop and café',
    locale: 'en-US',
    templateKey: 'coffee-story',
    templateVersion: 1,
    products: ['Espresso', 'Tea', 'Pastries'],
  });
  const manifest = coffeeStoryTrainingManifest(profile);
  const issues = validateTrainingManifest(manifest);
  if (issues.length > 0) throw new Error(`Baseline curriculum is invalid: ${issues.join('; ')}`);
  const prepared = prepareTrainingRelease(manifest);

  const template = await db.from('training_templates').upsert({
    template_key: 'coffee-story', version: 1, industry: profile.industry, locale: profile.locale,
    manifest: prepared.publicManifest, status: 'published',
  }, { onConflict: 'template_key,version' }).select('id').single<{ id: string }>();
  if (template.error) throw new Error(`Template seed failed: ${template.error.message}`);

  // Keep the reusable franchise template present even when a prior v2 release
  // means the tenant itself needs no new release row.
  const existing = await db.from('training_releases').select('id, manifest').eq('brand_id', brand.data.id).eq('status', 'published').maybeSingle<{ id: string; manifest: unknown }>();
  const existingManifest = existing.data?.manifest as { schemaVersion?: number } | undefined;
  if (!existing.error && existingManifest?.schemaVersion === 2) {
    process.stdout.write(JSON.stringify({ status: 'already_seeded', releaseId: existing.data?.id, templateId: template.data.id }) + '\n');
    return;
  }

  const fingerprint = createHash('sha256').update(JSON.stringify(profile)).digest('hex');
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
