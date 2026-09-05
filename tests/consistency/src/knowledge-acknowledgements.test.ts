import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const migration = read('supabase/migrations/20260904201331_knowledge_acknowledgements.sql');
const actions = read('apps/hq/app/(console)/knowledge/actions.ts');
const data = read('apps/hq/lib/knowledge-data.ts');
const navigation = read('apps/hq/lib/console-navigation.ts');

describe('production knowledge acknowledgements', () => {
  it('uses a tenant-bound normalized append-only ledger', () => {
    assert.match(migration, /create table public\.knowledge_acknowledgements/);
    assert.match(migration, /foreign key \(resource_id, brand_id\)/);
    assert.match(migration, /foreign key \(user_id, brand_id\)/);
    assert.match(migration, /unique \(brand_id, resource_id, user_id, resource_version\)/);
    assert.match(migration, /knowledge_acknowledgements_append_only/);
    assert.match(migration, /enable row level security/);
  });

  it('derives acknowledgement identity from the current caller', () => {
    assert.match(migration, /acknowledge_knowledge_resource\(p_resource_id uuid\)/);
    assert.match(migration, /caller uuid := \(select auth\.uid\(\)\)/);
    assert.doesNotMatch(migration, /acknowledge_knowledge_resource\([^)]*p_(?:brand|user)_id/);
    assert.match(
      migration,
      /grant execute on function public\.acknowledge_knowledge_resource\(uuid\)[\s\S]*to authenticated/,
    );
    assert.match(
      migration,
      /revoke all on function public\.acknowledge_knowledge_resource\(uuid\)[\s\S]*from public, anon, authenticated/,
    );
  });

  it('keeps live acknowledgement state out of catalog metadata', () => {
    assert.match(migration, /catalog_resources_no_embedded_acknowledgements/);
    assert.match(actions, /rpc\('acknowledge_knowledge_resource'/);
    assert.match(data, /from\('knowledge_acknowledgements'\)/);
    assert.doesNotMatch(actions, /acknowledgedUserIds/);
  });

  it('separates staff visibility from owner management', () => {
    assert.match(navigation, /canViewKnowledge/);
    assert.match(actions, /managementIntent && !hasRole\(session, 'brand_owner'\)/);
    assert.match(migration, /catalog_resources_owner_update/);
    assert.match(migration, /app\.can_read_knowledge_resource/);
  });
});
