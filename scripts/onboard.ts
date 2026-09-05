/**
 * Validate a tenant manifest, reconcile its database state, generate artwork,
 * and optionally apply only the guest surfaces declared by the manifest.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { applyAppArtwork } from './onboard-app-artwork.js';
import { applyTenantSlot, describeApplied } from './onboard-tenant-slots.js';
import { generateAppArtwork } from './lib/onboard-assets.js';
import { seedTenantDatabase } from './lib/onboard-database.js';
import { writeAppStoreListing } from './lib/onboard-listing.js';
import {
  TenantValidationError,
  validateTenant,
  type ValidatedTenant,
} from './lib/onboard-validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SCAFFOLD_SLUG = /^_[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Arguments = {
  slug: string;
  tenantDir: string;
  scaffold: boolean;
  apply: boolean;
  requireDatabase: boolean;
  ownerUserId: string | null;
  allowImagelessFixture: boolean;
};

function argValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readArguments(): Arguments {
  const slug = argValue('--tenant');
  const apply = process.argv.includes('--apply');
  const requireDatabase = process.argv.includes('--require-db');
  const ownerProvided = process.argv.includes('--owner-user-id');
  const ownerUserId = argValue('--owner-user-id');
  const scaffold = slug !== null && SCAFFOLD_SLUG.test(slug);
  if (!slug || !(TENANT_SLUG.test(slug) || scaffold)) {
    fail('Usage: pnpm onboard --tenant <slug> [--apply] [--owner-user-id <uuid>]');
  }
  if (scaffold && (apply || requireDatabase || ownerProvided)) {
    fail(`tenants/${slug} is scaffolding: it validates but cannot be seeded or applied.`);
  }
  if (ownerProvided && (!ownerUserId || !UUID.test(ownerUserId))) {
    fail('--owner-user-id must be a valid UUID.');
  }
  const tenantDir = join(process.cwd(), 'tenants', slug);
  if (!existsSync(join(tenantDir, 'brand.json'))) {
    fail(`No tenants/${slug}/brand.json. Copy tenants/_template first.`);
  }
  return {
    slug, tenantDir, scaffold, apply, requireDatabase, ownerUserId,
    allowImagelessFixture: process.argv.includes('--allow-imageless-schema-fixture')
      && slug === 'demo-roastery',
  };
}

function applyGuestSurfaces(args: Arguments, tenant: ValidatedTenant): void {
  if (!args.apply) {
    console.log('5. not applied: pass --apply to add declared guest-app tenant slots');
    console.log('6. artwork: not applied (pass --apply)');
    return;
  }
  const slot = applyTenantSlot({
    root: process.cwd(), slug: args.slug, tenantDir: args.tenantDir,
    menuJson: `${JSON.stringify(tenant.menu, null, 2)}\n`,
    itemSlugs: tenant.menu.items.map((item) => item.id),
    surfaces: tenant.guestSurfaces,
  });
  const result = tenant.guestSurfaces.length === 0
    ? 'no guest slots (removed this tenant from guest apps)'
    : `${slot.menuAssets} menu photographs, ${slot.cutouts.length} cut-outs`;
  console.log(`5. applied: ${result}`);
  console.log(`   tenants now bundled -- ${describeApplied(process.cwd())}`);
  console.log(`   build this one with EXPO_PUBLIC_TENANT=${args.slug}`);
  console.log(`6. artwork: ${applyAppArtwork(
    process.cwd(), args.slug, args.tenantDir, tenant.brand, tenant.guestSurfaces,
  )}`);
}

function validate(args: Arguments): ValidatedTenant {
  try {
    return validateTenant(args);
  } catch (error) {
    if (!(error instanceof TenantValidationError)) throw error;
    console.error(`tenants/${args.slug} does not validate:`);
    for (const problem of error.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
}

async function run(): Promise<void> {
  const args = readArguments();
  const tenant = validate(args);
  console.log(`1. validated brand.json${
    tenant.menuRows.length ? ` and menu.csv (${tenant.menuRows.length} items)` : ' (no menu.csv)'
  }`);
  if (tenant.brand.legacyLocation) {
    console.warn('   warning: legacy location is supported; migrate brand.json to locations[].');
  }
  if (args.scaffold) {
    console.log(`tenants/${args.slug} is scaffolding, so validation is where onboarding stops.`);
    return;
  }
  await seedTenantDatabase({
    tenantDir: args.tenantDir, tenant,
    ownerUserId: args.ownerUserId, requireDatabase: args.requireDatabase,
    allowSchemaFixtureCreation: args.allowImagelessFixture,
  });
  await generateAppArtwork(args.tenantDir, args.slug, tenant.brand);
  if (tenant.menuRows.length > 0 && tenant.brand.business) {
    writeAppStoreListing(args.tenantDir, args.slug, tenant.brand, tenant.brand.business);
  } else {
    console.log('4. listing: skipped (tenant ships no guest ordering menu)');
  }
  applyGuestSurfaces(args, tenant);
}

run().catch((error: unknown) => {
  console.error('onboard failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
