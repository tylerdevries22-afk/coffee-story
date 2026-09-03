/**
 * The registry lives here; the database needs it too.
 *
 * `module_installations.module_key` is a foreign key into `app.module_registry`
 * (20260903170000), and the anonymous capability projection decides what a
 * logged-out reader may learn from that table's `surfaces` column. Both of
 * those are SQL, and SQL cannot import TypeScript, so the seed is a copy --
 * and a copy of a security-relevant list is a liability until something fails
 * when it drifts.
 *
 * This is that something. It reads every migration that writes the table, so a
 * later migration adding a module is covered on the commit that adds it, and
 * compares the result to MODULE_REGISTRY key for key and surface for surface.
 * Drift in either direction is a failure: a key in SQL and not here would be a
 * capability no definition governs, and a key here and not in SQL is an
 * installation the database will refuse.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MODULE_REGISTRY } from './registry';

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
);

/** Every migration that mentions the table, oldest first, concatenated. */
function registrySql(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
    .filter((sql) => sql.includes('app.module_registry'));
  assert.ok(files.length > 0, 'no migration seeds app.module_registry');
  return files.join('\n');
}

/**
 * The seeded rows, as `(key, surfaces)` pairs.
 *
 * Deliberately a shape match rather than a SQL parse: the tuple form below is
 * the only one the seed is allowed to use, so a migration that seeds the table
 * some other way reads as zero rows here and fails the comparison loudly
 * instead of being silently skipped.
 */
function seededRows(): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  const tuple = /\('([a-z][a-z0-9-]*)',\s*array\[([^\]]+)\]\)/g;
  for (const match of registrySql().matchAll(tuple)) {
    const key = match[1];
    const surfaces = match[2];
    if (!key || !surfaces) continue;
    rows.set(key, [...surfaces.matchAll(/'([a-z]+)'/g)].map((entry) => entry[1] as string));
  }
  return rows;
}

describe('app.module_registry mirrors MODULE_REGISTRY', () => {
  it('seeds every module the platform ships, and nothing it does not', () => {
    const seeded = [...seededRows().keys()].sort();
    const authored = MODULE_REGISTRY.map((definition) => definition.key).sort();
    assert.deepEqual(seeded, authored,
      'the SQL registry and MODULE_REGISTRY name different modules');
  });

  it('carries the same surfaces, which is what the anon projection filters on', () => {
    const seeded = seededRows();
    for (const definition of MODULE_REGISTRY) {
      assert.deepEqual(
        [...(seeded.get(definition.key) ?? [])].sort(),
        [...definition.surfaces].sort(),
        `${definition.key} declares different surfaces in SQL`,
      );
    }
  });
});

describe('the anonymous capability projection', () => {
  const sql = registrySql();

  it('publishes customer-facing modules only, decided server-side', () => {
    const body = /create or replace function app\.brand_storefront_capability_rows\([\s\S]+?\$\$;/
      .exec(sql)?.[0];
    assert.ok(body, 'the projection is missing');
    assert.match(body, /returns table \(slug text, module_key text\)/,
      'two columns is the contract: a third is how config or state would leak');
    assert.match(body, /stable\s+security definer\s+set search_path = ''/);
    assert.match(body, /installation\.state = 'active'/);
    assert.match(body, /'customer' = any \(registry\.surfaces\)/,
      'the allow-list must be the registry surfaces, in SQL, not a client filter');
    for (const column of ['config', 'config_revision', 'installed_by', 'created_at', 'updated_at']) {
      assert.doesNotMatch(body, new RegExp(`installation\\.${column}\\b`),
        `${column} must never reach an anonymous reader`);
    }
    for (const table of ['site_module_overrides', 'delegated_access_grants']) {
      assert.doesNotMatch(body, new RegExp(table), `${table} has no place on the anon path`);
    }
  });

  it('would withhold every module that is not customer-facing', () => {
    // Stated as data rather than as a list: this is the disclosure the filter
    // exists to prevent, and naming the modules here would date immediately.
    const withheld = MODULE_REGISTRY
      .filter((definition) => !definition.surfaces.includes('customer'))
      .map((definition) => definition.key);
    assert.ok(withheld.includes('device-wall'),
      'a device wall is operational hardware, not a storefront fact');
    assert.ok(withheld.includes('workforce-operations'),
      'staff scheduling is not a storefront fact either');
    assert.ok(withheld.includes('construction-projects'));
    assert.ok(withheld.includes('local-printing'),
      'kiosk-only modules are withheld: a paired device has an identity, an '
      + 'anonymous reader has no claim on hardware facts');
  });
});
