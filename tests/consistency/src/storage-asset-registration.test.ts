import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Anything that uploads to a governed bucket also registers what it uploaded.
 *
 * `app.platform_release_readiness_20260901060005()` raises `one or more storage
 * objects are missing a registry record` when an object in `menu-images`,
 * `training-media`, `brand-assets` or `content-files` has no matching
 * `public.storage_assets` row. It is a release-gate assertion, so an
 * unregistered object does not fail the upload -- it fails the *release*, some
 * time later, for reasons that point at storage rather than at the writer.
 *
 * That is exactly what happened: `scripts/onboard.ts` uploaded every tenant's
 * menu images and never wrote the registry, because the HQ console was the only
 * writer anyone had added. For a franchise platform the consequence is the bad
 * one -- onboarding a new location is what breaks the release.
 *
 * The gate cannot catch this on a pull request, because catching it needs a
 * seeded database and the only job with one is skipped on PRs. This can, and it
 * needs nothing but the source text.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The buckets the readiness assertion audits. Keep in step with that migration. */
const GOVERNED = ['menu-images', 'training-media', 'brand-assets', 'content-files'];

function sources(dir: string): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      found.push({ path: full.slice(ROOT.length + 1), text: readFileSync(full, 'utf8') });
    }
  }
  return found;
}

const files = [
  ...sources(join(ROOT, 'scripts')),
  ...sources(join(ROOT, 'apps/hq/lib')),
  ...sources(join(ROOT, 'apps/hq/app')),
];

/** Files that call `.upload(` on one of the governed buckets. */
const uploaders = files.filter(({ text }) =>
  GOVERNED.some((bucket) => new RegExp(`from\\(['"\`]${bucket}['"\`]\\)[\\s\\S]{0,400}?\\.upload\\(`).test(text)));

describe('every governed-bucket upload is registered', () => {
  it('finds the sources, so the guard cannot pass by scanning nothing', () => {
    assert.ok(files.length > 50, `scanned only ${files.length} files`);
    assert.ok(uploaders.length > 0,
      'no upload site found at all -- this guard is looking at the wrong tree');
  });

  it('registers in the same file that uploads', () => {
    // Either the direct table write the HQ console does, or a call to the
    // shared helper the scripts use -- both put the row there, and which one
    // is right depends on whether the caller holds a session or the service key.
    const unregistered = uploaders
      .filter(({ text }) => !text.includes('storage_assets') && !text.includes('registerStorageAsset'))
      .map(({ path }) => path)
      .sort();
    assert.deepEqual(unregistered, [],
      'these files upload into a governed bucket without registering the object. '
      + 'It lands, and then the release gate raises "one or more storage objects '
      + 'are missing a registry record" -- far from here, and pointing at storage '
      + 'rather than at this code. Call registerStorageAsset in the same step.');
  });

  /**
   * Onboarding is the path a new franchise location takes, so it is the one
   * that must not leave the platform unreleasable. Named directly rather than
   * left to the general rule above, because it is the case that broke.
   */
  it('registers menu images on the onboarding path specifically', () => {
    const menuImages = files.find(({ path }) => path === 'scripts/onboard-menu-images.ts');
    assert.ok(menuImages, 'scripts/onboard-menu-images.ts moved; repoint this guard');
    assert.match(menuImages.text, /registerStorageAsset\(db, \{[\s\S]{0,300}?bucketId: 'menu-images'/,
      'onboarding uploads menu images; it must register them too');

    const helper = files.find(({ path }) => path === 'scripts/storage-registry.ts');
    assert.ok(helper, 'scripts/storage-registry.ts moved; repoint this guard');
    assert.match(helper.text, /onConflict: 'bucket_id,object_path'/,
      're-running onboarding must not fail on an object it already registered');
    assert.match(helper.text, /ignoreDuplicates: true/,
      'onboarding is idempotent by contract; a second run must not raise');
  });
});
