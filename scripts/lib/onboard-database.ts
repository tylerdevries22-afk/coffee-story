import type { SupabaseClient } from '@supabase/supabase-js';

import { reconcileTenantModules } from '../onboard-module-installs.js';
import { seedTenantMenu } from './onboard-database-menu.js';
import { seedTenantOperations } from './onboard-operations.js';
import { resilientFetch } from './onboard-runtime.js';
import type { ValidatedTenant } from './onboard-validation.js';

function brandConfig(tenant: ValidatedTenant): Record<string, unknown> {
  const brand = tenant.brand;
  return {
    schemaVersion: brand.schemaVersion,
    organization: brand.organization,
    network: brand.network,
    inheritance: brand.inheritance,
    surfaces: brand.surfaces,
    providers: brand.providers,
    identity: { slug: brand.identity.slug, scheme: brand.identity.scheme },
    tokens: brand.tokens,
    copy: brand.copy,
    ...(brand.business ? { business: brand.business } : {}),
    ...(brand.tax ? { tax: brand.tax } : {}),
    ...(brand.kiosk ? { kiosk: brand.kiosk } : {}),
    ...(brand.loyalty ? { loyalty: brand.loyalty } : {}),
    ...(brand.board ? { board: brand.board } : {}),
  };
}

function brandRow(tenant: ValidatedTenant): Record<string, unknown> {
  const brand = tenant.brand;
  return {
    slug: brand.identity.slug,
    name: brand.identity.name,
    ...(brand.fees ? {
      fee_bps: brand.fees.feeBps,
      fee_bps_tier2: brand.fees.feeBpsTier2,
      tier_threshold_cents: brand.fees.tierThresholdCents,
    } : {}),
    ...brand.features,
    brand_config: brandConfig(tenant),
  };
}

export function hostedSeedTargetIssue(
  brand: { id: string; status: string } | null,
  run: { stage: string } | null,
): string | null {
  if (!brand) return 'Hosted onboarding requires an organization provisioned through the HQ workflow.';
  if (!run) return 'Hosted onboarding requires the organization provisioning ledger.';
  const valid = (brand.status === 'provisioning'
      && (run.stage === 'awaiting_external' || run.stage === 'ready'))
    || (brand.status === 'active' && run.stage === 'active');
  return valid ? null : 'Hosted onboarding refused an inconsistent organization lifecycle.';
}

async function provisionedBrandId(
  db: SupabaseClient,
  tenant: ValidatedTenant,
): Promise<string> {
  const slug = tenant.brand.identity.slug;
  const brandResult = await db.from('brands').select('id,status').eq('slug', slug)
    .maybeSingle<{ id: string; status: string }>();
  if (brandResult.error) throw brandResult.error;
  const runResult = brandResult.data
    ? await db.from('organization_provisioning_runs').select('stage')
      .eq('brand_id', brandResult.data.id).maybeSingle<{ stage: string }>()
    : { data: null, error: null };
  if (runResult.error) throw runResult.error;
  const issue = hostedSeedTargetIssue(brandResult.data, runResult.data);
  if (issue) throw new Error(issue);
  const id = brandResult.data?.id;
  if (!id) throw new Error('Hosted onboarding could not resolve the provisioned organization.');
  const update = await db.from('brands').update(brandRow(tenant)).eq('id', id);
  if (update.error) throw update.error;
  return id;
}

async function upsertBrand(
  db: SupabaseClient,
  tenant: ValidatedTenant,
  requireProvisioned: boolean,
): Promise<string> {
  if (requireProvisioned) return provisionedBrandId(db, tenant);
  const { data, error } = await db.from('brands').upsert(
    brandRow(tenant), { onConflict: 'slug' },
  ).select('id').single();
  if (error) throw error;
  return data.id;
}

async function upsertLocations(
  db: SupabaseClient, brandId: string, tenant: ValidatedTenant,
): Promise<{ id: string; timezone: string }[]> {
  const rows: { id: string; timezone: string }[] = [];
  for (const location of tenant.brand.locations) {
    const { data, error } = await db.from('locations').upsert({
      brand_id: brandId, name: location.name, address: location.address,
      hours: location.hours, timezone: location.timezone,
    }, { onConflict: 'brand_id,name' }).select('id').single();
    if (error) throw error;
    rows.push({ id: data.id, timezone: location.timezone });
  }
  return rows;
}

async function assignOwner(
  db: SupabaseClient, ownerUserId: string | null, brandId: string,
  locations: readonly { id: string }[],
): Promise<void> {
  if (!ownerUserId) return;
  const { error } = await db.from('brand_users').upsert({
    user_id: ownerUserId, brand_id: brandId, role: 'brand_owner',
    location_ids: locations.map((location) => location.id),
  }, { onConflict: 'user_id,brand_id' });
  if (error) throw error;
}

export async function seedTenantDatabase(input: {
  tenantDir: string;
  tenant: ValidatedTenant;
  ownerUserId: string | null;
  requireDatabase: boolean;
  allowSchemaFixtureCreation: boolean;
}): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if ((input.requireDatabase || input.ownerUserId) && (!url || !key)) {
    throw new Error('--require-db and --owner-user-id need Supabase service credentials.');
  }
  if (!url || !key) {
    console.log('2. database: skipped (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)');
    return;
  }
  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(url, key, {
    auth: { persistSession: false }, global: { fetch: resilientFetch },
  });
  const brandId = await upsertBrand(
    db, input.tenant, input.requireDatabase && !input.allowSchemaFixtureCreation,
  );
  const modules = await reconcileTenantModules(db, brandId, input.tenantDir, input.tenant.modules);
  console.log(`   modules: ${modules.enabled.join(', ') || 'none'} (manifest reconciled)`);
  const locations = await upsertLocations(db, brandId, input.tenant);
  await assignOwner(db, input.ownerUserId, brandId, locations);
  if (input.tenant.operations) {
    await seedTenantOperations(db, brandId, locations, input.tenant.operations);
    console.log(`   operations: ${input.tenant.operations.templates.length} templates synced`);
  }
  const uploaded = await seedTenantMenu(db, brandId, input.tenantDir, input.tenant);
  if (input.tenant.menuRows.length > 0) console.log(`   media: ${uploaded} menu thumbnails synced`);
  const owner = input.ownerUserId ? ` + owner ${input.ownerUserId} assigned` : '';
  console.log(`2. database: brand + ${locations.length} locations + ${input.tenant.menuRows.length} menu items${owner}`);
}
