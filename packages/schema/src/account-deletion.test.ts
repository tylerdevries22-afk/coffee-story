import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

const migration = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations/20260824080000_customer_account_deletion.sql'),
  'utf8',
);

describe('customer account deletion', () => {
  it('anonymizes PII and revokes every push token without deleting customer history', () => {
    assert.match(migration, /delete from public\.push_tokens/);
    assert.match(migration, /update public\.customers/);
    assert.match(migration, /full_name = 'Deleted account'/);
    assert.match(migration, /email = null/);
    assert.match(migration, /phone = null/);
    assert.doesNotMatch(migration, /delete from public\.customers/);
  });

  it('keeps the definer function private to the service role', () => {
    assert.match(migration, /security definer/);
    assert.match(migration, /set search_path = ''/);
    assert.match(migration, /create or replace function public\.anonymize_customer_account/);
    assert.match(migration, /revoke all on function public\.anonymize_customer_account\(uuid\) from public, anon, authenticated/);
    assert.match(migration, /grant execute on function public\.anonymize_customer_account\(uuid\) to service_role/);
  });
});
