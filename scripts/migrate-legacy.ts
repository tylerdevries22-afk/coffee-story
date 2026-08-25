/**
 * Backfills the legacy single-tenant deployment into the first brand and
 * location of the multi-tenant schema.
 *
 * What legacy data there is: the original app kept no database schema in this
 * repo -- Supabase held auth users only, and business data lived behind an
 * external appointment-shaped portal API this script cannot reach. So the
 * backfill is:
 *
 *   1. Ensure the tenant brand row exists (from tenants/<slug>/brand.json,
 *      default coffee-story), with its location.
 *   2. Walk auth.users and upsert a customers row per user under that brand.
 *   3. Report what was migrated and what has no source to migrate from
 *      (orders, loyalty balances) so nobody believes more moved than did.
 *
 * Idempotent: brand upserts on slug, customers on (brand_id, user_id).
 * Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-side only).
 *
 *   pnpm onboard --tenant coffee-story  # creates the brand first (Phase 8)
 *   npx tsx scripts/migrate-legacy.ts [tenant-slug]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createClient } from '@supabase/supabase-js';

const slug = process.argv[2] ?? 'coffee-story';
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('migrate-legacy: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side only).');
  process.exit(1);
}

type BrandFile = {
  identity?: { name?: string };
  location?: { name?: string; address?: Record<string, unknown>; timezone?: string; hours?: Record<string, unknown> };
};

function readBrandFile(): BrandFile {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), 'tenants', slug, 'brand.json'), 'utf8')) as BrandFile;
  } catch {
    return {};
  }
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

async function run() {
  const brandFile = readBrandFile();

  const { data: brand, error: brandError } = await db
    .from('brands')
    .upsert({ slug, name: brandFile.identity?.name ?? slug }, { onConflict: 'slug' })
    .select('id, slug, name')
    .single();
  if (brandError) throw brandError;
  console.log(`brand: ${brand.name} (${brand.id})`);

  const locationName = brandFile.location?.name ?? 'Main';
  const { data: existingLocation } = await db
    .from('locations').select('id').eq('brand_id', brand.id).eq('name', locationName).maybeSingle();
  let locationId = existingLocation?.id;
  if (!locationId) {
    const { data: createdLocation, error: locationError } = await db
      .from('locations')
      .insert({
        brand_id: brand.id,
        name: locationName,
        address: brandFile.location?.address ?? {},
        hours: brandFile.location?.hours ?? {},
        timezone: brandFile.location?.timezone ?? 'America/Denver',
      })
      .select('id')
      .single();
    if (locationError) throw locationError;
    locationId = createdLocation.id;
  }
  console.log(`location: ${locationName} (${locationId})`);

  // auth.users -> customers, one page at a time.
  let page = 1;
  let migrated = 0;
  let skipped = 0;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    if (data.users.length === 0) break;
    for (const user of data.users) {
      const { error: upsertError } = await db.from('customers').upsert(
        {
          brand_id: brand.id,
          user_id: user.id,
          phone: user.phone ?? null,
          email: user.email ?? null,
          full_name: (user.user_metadata?.full_name as string | undefined) ?? '',
        },
        { onConflict: 'brand_id,user_id' },
      );
      if (upsertError) {
        console.warn(`  skip ${user.id}: ${upsertError.message}`);
        skipped += 1;
      } else {
        migrated += 1;
      }
    }
    page += 1;
  }

  console.log(`customers migrated: ${migrated}${skipped ? `, skipped: ${skipped}` : ''}`);
  console.log(
    'not migrated (no source exists in this stack): orders, loyalty balances,\n' +
    'gift-card balances -- the legacy portal held them behind appointment-shaped\n' +
    'APIs. Export them from that system and load via the engine if they matter.',
  );
}

run().catch((error) => {
  console.error('migrate-legacy failed:', error?.message ?? error);
  process.exit(1);
});
