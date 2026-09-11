import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

const migration = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations/20260911120000_franchise_data_lifecycle.sql'),
  'utf8',
);
const brandExport = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations/20260911130000_brand_organization_export.sql'),
  'utf8',
);

describe('franchise data lifecycle', () => {
  it('exports guest data without raw push tokens and keeps the RPC service-role only', () => {
    assert.match(migration, /create or replace function public\.export_customer_account_data/);
    assert.match(migration, /from public\.customers customer/);
    assert.match(migration, /from public\.orders ord/);
    assert.match(migration, /from public\.loyalty_accounts account/);
    assert.match(migration, /'platform', token\.platform/);
    assert.doesNotMatch(migration, /token\.token/);
    assert.match(migration, /revoke all on function public\.export_customer_account_data\(uuid\) from public, anon, authenticated/);
    assert.match(migration, /grant execute on function public\.export_customer_account_data\(uuid\) to service_role/);
  });

  it('offboards brands as a terminal platform_admin step without hard delete', () => {
    assert.match(migration, /create or replace function public\.offboard_brand/);
    assert.match(migration, /platform_admin/);
    assert.match(migration, /status = 'offboarded'/);
    assert.match(migration, /brands\.offboard/);
    assert.doesNotMatch(migration, /delete from public\.brands/);
    assert.match(migration, /grant execute on function public\.offboard_brand\(uuid, text\) to authenticated/);
  });

  it('protects the last location on brand_owner delete', () => {
    assert.match(migration, /create or replace function public\.delete_location_if_allowed/);
    assert.match(migration, /last_location_protected/);
    assert.match(migration, /app\.is_brand_owner/);
    assert.match(migration, /grant execute on function public\.delete_location_if_allowed\(uuid\) to authenticated/);
  });
});

describe('brand organization export', () => {
  it('exports org data for brand_owner and keeps anon out', () => {
    assert.match(brandExport, /create or replace function public\.export_brand_organization_data/);
    assert.match(brandExport, /app\.is_brand_owner/);
    assert.match(brandExport, /from public\.locations location/);
    assert.match(brandExport, /from public\.customers customer/);
    assert.doesNotMatch(brandExport, /access_token|credential_reference|from public\.push_tokens/i);
    assert.match(brandExport, /revoke all on function public\.export_brand_organization_data\(uuid\) from public, anon/);
    assert.match(brandExport, /grant execute on function public\.export_brand_organization_data\(uuid\) to authenticated/);
    assert.match(brandExport, /register_release\(\s*'20260911130000'/);
  });
});
