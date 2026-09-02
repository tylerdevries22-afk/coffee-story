import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
);
const migrationFile = readdirSync(migrationsDir)
  .find((name) => /^\d{14}_franchise_module_foundations\.sql$/.test(name));
assert.ok(migrationFile, 'the franchise module foundations migration exists');
const migration = readFileSync(join(migrationsDir, migrationFile), 'utf8');

const tables = [
  'franchise_networks',
  'franchise_memberships',
  'franchise_network_brands',
  'module_installations',
  'module_installation_events',
  'site_module_overrides',
  'delegated_access_grants',
];
const guardedWriters = ['set_module_installation_state', 'network_brand_kpis'];

describe('module franchise foundations database boundary', () => {
  it('enables row level security on every new table', () => {
    for (const table of tables) {
      assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));
      assert.match(migration, new RegExp(`create policy ${table}_select on public\\.${table}`));
    }
  });

  it('revokes broad table privileges before granting narrow ones', () => {
    for (const table of tables) {
      const revoke = migration.indexOf(`revoke all on public.${table} from public, anon, authenticated;`);
      const select = migration.indexOf(`grant select on public.${table} to authenticated;`);
      const service = migration.indexOf(`grant all on public.${table} to service_role;`);
      assert.ok(revoke > -1, `${table} revokes public, anon and authenticated`);
      assert.ok(revoke < select && select < service,
        `${table} grants select after the revoke and service_role last`);
      assert.doesNotMatch(migration,
        new RegExp(`grant (insert|update|delete)[^;]*on public\\.${table}[^;]*to authenticated`),
        `${table} never grants writes to authenticated`);
    }
  });

  it('keeps module installation history append-only', () => {
    assert.match(migration,
      /create or replace function app\.reject_module_installation_event_mutation\(\) returns trigger/);
    assert.match(migration,
      /errcode = '55000', message = 'module_installation_event_append_only'/);
    assert.match(migration,
      /create trigger module_installation_events_append_only before update or delete\s+on public\.module_installation_events/);
    assert.match(migration,
      /revoke all on function app\.reject_module_installation_event_mutation\(\)\s+from public, anon, authenticated;/);
  });

  it('locks the guarded writers to the service role with an empty search path', () => {
    for (const name of guardedWriters) {
      assert.match(migration,
        new RegExp(`create or replace function app\\.${name}\\([\\s\\S]+?security definer\\s+set search_path = ''`));
      assert.match(migration,
        new RegExp(`revoke all on function app\\.${name}\\([\\s\\S]+?from public, anon, authenticated;`));
      assert.match(migration,
        new RegExp(`grant execute on function app\\.${name}\\([\\s\\S]+?to service_role;`));
      assert.doesNotMatch(migration,
        new RegExp(`grant execute on function app\\.${name}\\([\\s\\S]+?to (anon|authenticated)`));
    }
  });

  it('answers franchise membership through definer helpers policies can call', () => {
    for (const name of ['is_franchise_network_member', 'is_franchise_network_admin']) {
      assert.match(migration,
        new RegExp(`create or replace function app\\.${name}\\(p_network_id uuid, p_user_id uuid\\)[\\s\\S]+?security definer\\s+set search_path = ''`));
      // Revoking these would break every franchise policy that calls them.
      assert.doesNotMatch(migration, new RegExp(`revoke all on function app\\.${name}`));
    }
  });

  it('enforces the module lifecycle with optimistic concurrency', () => {
    assert.match(migration,
      /where target\.id = p_installation_id and target\.brand_id = p_brand_id\s+for update/);
    assert.match(migration,
      /installation\.state = 'validating' and p_to_state in \('active', 'error'\)/,
      'a failed validation must be able to reach the error state');
    assert.match(migration,
      /errcode = '22023', message = 'invalid_module_state_transition'/);
    assert.match(migration,
      /errcode = '40001', message = 'module_installation_revision_conflict'/);
    assert.match(migration,
      /config_revision = next_revision[\s\S]+?insert into public\.module_installation_events/);
  });

  it('scopes delegated access by brand, capability, and a 30-day lifetime', () => {
    assert.match(migration,
      /create or replace function app\.valid_delegated_scope\(p_values text\[\]\)/);
    assert.match(migration,
      /cardinality\(scope\) <= 32 and app\.valid_delegated_scope\(scope\)/);
    assert.match(migration, /expires_at <= created_at \+ interval '30 days'/);
    assert.match(migration,
      /create index delegated_access_grants_grantee_expiry_idx[\s\S]+?\(grantee_user_id, expires_at\)/);
  });

  it('answers network KPIs as aggregates behind an access check', () => {
    assert.match(migration,
      /returns table \(brand_id uuid, orders_30d integer, gross_cents_30d bigint\)/);
    assert.match(migration, /errcode = 'P0002', message = 'network_access_denied'/);
    assert.match(migration, /'network:kpis' = any \(grant_row\.scope\)/);
    assert.match(migration, /grant_row\.revoked_at is null/);
    assert.match(migration, /grant_row\.expires_at > pg_catalog\.now\(\)/);
  });

  it('extends the release-readiness chain from the device-wall link', () => {
    assert.match(migration,
      /alter function public\.platform_release_readiness\(\)\s+rename to platform_release_readiness_20260902021857;/);
    assert.match(migration,
      /alter function public\.platform_release_readiness_20260902021857\(\) set schema app;/);
    assert.match(migration,
      /create or replace function public\.platform_release_readiness\(\)[\s\S]+?app\.platform_release_readiness_20260902021857\(\) <> '20260902021857'[\s\S]+?return '20260902083817'/);
    for (const table of tables) {
      assert.match(migration, new RegExp(`to_regclass\\('public\\.${table}'\\)`),
        `readiness asserts ${table} exists`);
    }
    assert.match(migration,
      /revoke all on function public\.platform_release_readiness\(\)[\s\S]+?from public, anon, authenticated;[\s\S]+?grant execute on function public\.platform_release_readiness\(\)[\s\S]+?to service_role;/);
  });
});

describe('foreign key covering-index repair', () => {
  const repairFile = readdirSync(migrationsDir)
    .find((name) => /^\d{14}_franchise_device_wall_fk_indexes\.sql$/.test(name));
  assert.ok(repairFile, 'the FK covering-index repair migration exists');
  const repair = readFileSync(join(migrationsDir, repairFile), 'utf8');

  it('covers every key the hosted gate can name', () => {
    for (const index of [
      'delegated_access_grants_brand_id_idx',
      'device_stream_sessions_viewer_id_idx',
      'device_installations_installed_by_idx',
      'device_installations_paired_brand_location_idx',
      'module_installation_events_installation_idx',
      'franchise_memberships_user_id_idx',
      'site_module_overrides_brand_module_idx',
    ]) {
      assert.match(repair, new RegExp(`create index if not exists ${index}`),
        `repair adds ${index}`);
    }
  });

  it('extends the readiness chain and pins the spot assertions', () => {
    assert.match(repair,
      /rename to platform_release_readiness_20260902083817;/);
    assert.match(repair,
      /app\.platform_release_readiness_20260902083817\(\) <> '20260902083817'[\s\S]+?return '\d{14}'/);
    assert.match(repair,
      /revoke all on function public\.platform_release_readiness\(\)[\s\S]+?to service_role;/);
  });
});
