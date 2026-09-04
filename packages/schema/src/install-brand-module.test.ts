import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { LEGACY_FLAG_MODULE_MAP } from '../../module-kit/src/registry.js';

/**
 * Onboarding can install a module, and only through the guarded writer.
 *
 * `module_installations` is the authorization root: `service_role` holds SELECT
 * and nothing else, and `app.reject_unguarded_module_installation_write` refuses
 * any insert that did not come through `app.create_module_installation`. That is
 * correct, and it left onboarding with no way in at all -- the creation function
 * lives in schema `app`, and PostgREST only exposes `public`, so the Supabase
 * client `pnpm onboard` is built on could not reach it.
 *
 * `20260904030000` adds the front door. These assertions pin the two properties
 * that make it a front door rather than a hole: it is service-role only, and it
 * delegates rather than writing the table itself.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');

const sql = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
  .join('\n');

const installer = readFileSync(
  join(MIGRATIONS, '20260904030000_install_brand_module_rpc.sql'), 'utf8',
);

describe('public.install_brand_module', () => {
  it('is reachable from PostgREST, which means it is in public', () => {
    assert.match(installer, /create or replace function public\.install_brand_module\(/,
      'a function in schema app cannot be called by the Supabase client');
  });

  it('runs as definer with an empty search_path', () => {
    assert.match(installer, /security definer\s+set search_path = ''/,
      'it writes through a definer helper, so its own search_path must be pinned');
  });

  it('is granted to service_role and to nobody else', () => {
    assert.match(installer, /revoke all on function public\.install_brand_module\([^)]*\)\s*\n\s*from public, anon, authenticated;/,
      'a client role that can install a module can grant itself capability');
    assert.match(installer, /grant execute on function public\.install_brand_module\([^)]*\)\s*\n\s*to service_role;/);
  });

  it('delegates to the guarded writer instead of inserting directly', () => {
    assert.match(installer, /app\.create_module_installation\(/,
      'inserting directly would skip the audit trail and hit the guard trigger');
    assert.match(installer, /app\.set_module_installation_state\(/,
      'create lands in draft; active is two audited transitions away');
    assert.doesNotMatch(installer, /insert into public\.module_installations/,
      'this must never write the authorization root itself');
  });

  /**
   * The safety property that makes it re-runnable. Onboarding is run routinely,
   * and a module may be sitting in `suspended` because an operator put it there.
   */
  it('returns an existing installation untouched rather than reactivating it', () => {
    assert.match(installer, /if found then\s*\n\s*return existing\.id;/,
      're-running onboarding must not undo a deliberate suspension');
  });

  it('registers its release without adding a redundant assertion', () => {
    // The parity assertion from 20260902220257 already states the outcome this
    // function exists to satisfy; a second one would evaluate the same facts.
    assert.match(installer, /select app\.register_release\(\s*'20260904030000'/);
    assert.doesNotMatch(installer, /::regprocedure/);
  });
});

describe('the flags onboarding installs for', () => {
  it('maps every legacy flag to a module the backfill also installs', () => {
    for (const [flag, moduleKey] of Object.entries(LEGACY_FLAG_MODULE_MAP)) {
      assert.ok(sql.includes(`'${moduleKey}'`),
        `${flag} maps to ${moduleKey}, which no migration ever installs`);
    }
  });
});
