import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations/20260831171620_franchise_admin_control_plane.sql',
), 'utf8');
const hardeningMigration = readFileSync(join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations/20260824072313_harden_onboarding_and_refunds.sql',
), 'utf8');

describe('franchise administration database boundary', () => {
  it('keeps platform-only functions off authenticated and anonymous roles', () => {
    for (const name of [
      'record_platform_access', 'ensure_platform_brand_membership',
      'manage_platform_brand_member', 'import_platform_brand_menu',
      'set_platform_brand_settings_config', 'set_platform_kiosk_config',
      'get_platform_fee_terms', 'set_platform_location_fee_overrides',
    ]) {
      assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]+?authenticated;`));
      assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]+?to service_role;`));
    }
  });

  it('checks staff locations and audit locations against the requested brand', () => {
    assert.match(migration, /location\.brand_id = new\.brand_id/);
    assert.match(migration, /location\.id = p_location_id and location\.brand_id = p_brand_id/);
    assert.match(migration, /where id = p_location_id and brand_id = p_brand_id/);
  });

  it('retains the prerequisites used by platform membership and menu import', () => {
    assert.match(hardeningMigration, /app\.jwt_role\(\) is not null[\s\S]+?app\.jwt_role\(\) is distinct from 'platform_admin'/);
    assert.match(hardeningMigration, /create unique index menu_categories_menu_title_idx[\s\S]+?\(menu_id, title\)/);
    assert.match(migration, /on conflict \(menu_id, title\) do nothing/);
    assert.match(migration, /on conflict \(user_id, brand_id\) do nothing[\s\S]+?select member\.id into result_id/);
  });

  it('serializes membership changes and protects platform and final-owner rows', () => {
    assert.match(migration, /from public\.brands brand where brand\.id = p_brand_id for update/);
    assert.match(migration, /message = 'platform_member_immutable'/);
    assert.match(migration, /and \(p_remove or p_role <> 'brand_owner'\)/);
    assert.match(migration, /event\.correlation_id = p_correlation_id/);
    assert.match(migration, /app\.jwt_role\(\) is distinct from 'brand_owner'/);
    assert.match(migration, /member\.user_id = auth\.uid\(\)[\s\S]+?member\.brand_id = p_brand_id[\s\S]+?member\.role = 'brand_owner'/);
    assert.match(migration, /revoke insert, update, delete on table public\.brand_users[\s\S]+?authenticated/);
  });

  it('separates home menu imports from audited platform imports', () => {
    assert.match(migration, /create or replace function public\.import_brand_menu[\s\S]+?app\.jwt_brand_id\(\) is distinct from p_brand_id/);
    assert.match(migration, /create or replace function public\.import_platform_brand_menu[\s\S]+?app\.require_platform_audit\([\s\S]+?'menu\.import'/);
  });

  it('binds every privileged writer to its exact current audit event', () => {
    assert.match(migration, /create or replace function app\.require_platform_audit[\s\S]+?member\.role = 'platform_admin'[\s\S]+?event\.location_id is not distinct from p_location_id[\s\S]+?event\.correlation_id = p_correlation_id/);
    for (const action of ['brand.settings.update', 'kiosk.config.update', 'fees.location.update']) {
      assert.match(migration, new RegExp(`app\\.require_platform_audit\\([\\s\\S]+?'${action.replaceAll('.', '\\.')}'`));
    }
    assert.match(migration, /set_platform_brand_settings_config\(uuid, uuid, jsonb, uuid, timestamptz\)/);
    assert.match(migration, /set_platform_kiosk_config\(uuid, uuid, jsonb, uuid, timestamptz\)/);
    assert.match(migration, /set_platform_location_fee_overrides\(uuid, uuid, uuid, uuid, integer, integer, bigint\)/);
  });

  it('meters menu extraction durably and serializes each brand budget', () => {
    assert.match(migration, /create table if not exists app\.menu_extraction_budgets/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /coalesce\(actor_count, 0\) >= 10 or brand_count >= 50/);
    assert.match(migration, /grant execute on function public\.consume_menu_extraction_budget\(uuid\)[\s\S]+?to authenticated/);
  });

  it('chains from the immediately preceding release and advertises itself', () => {
    assert.match(migration, /platform_release_readiness_20260831121801\(\)/);
    assert.match(migration, /return '20260831171620'/);
  });
});
