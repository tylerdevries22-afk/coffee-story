import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const migration = readFileSync(new URL(
  '../../../supabase/migrations/20260905093303_connector_oauth_runtime.sql',
  import.meta.url,
), 'utf8').toLowerCase();

describe('connector OAuth migration', () => {
  it('binds state transitions to tenant owners and consumes each nonce once', () => {
    assert.match(migration, /member\.brand_id = p_brand_id/);
    assert.match(migration, /state\.consumed_at is null/);
    assert.match(migration, /set consumed_at = now\(\)/);
    assert.match(migration, /state\.expires_at > now\(\)/);
    assert.match(migration, /connector_oauth_states_active_actor_idx/);
    assert.match(migration, /http:\/\//);
    assert.match(migration, /localhost\|127\[\.\]0\[\.\]0\[\.\]1/);
  });

  it('keeps credentials in Vault and revokes the prior secret after rotation', () => {
    assert.match(migration, /public\.store_connector_secret/);
    assert.match(migration, /public\.revoke_connector_secret/);
    assert.match(migration, /credential_reference_id = v_reference_id/);
  });

  it('exposes every OAuth RPC to service role only', () => {
    for (const name of [
      'begin_connector_oauth_state',
      'consume_connector_oauth_state',
      'complete_connector_oauth_connection',
    ]) {
      const signature = String.raw`${name}\(`;
      assert.match(migration, new RegExp(`revoke all on function public\\.${signature}[^;]+from public, anon, authenticated`));
      assert.match(migration, new RegExp(`grant execute on function public\\.${signature}[^;]+to service_role`));
    }
  });
});
