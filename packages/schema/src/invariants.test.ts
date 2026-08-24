import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

/**
 * Invariants that hold across the whole migration set, rather than inside any
 * one migration.
 *
 * Each of these was a real incident before it was a test. Migrations are
 * append-only files reviewed one at a time, which makes them the easiest place
 * in the tree for a property to be true of every file individually and false
 * of the set — so the set is what gets checked here.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
}

/** Every migration, concatenated in the order Postgres will apply them. */
function orderedSql(): string {
  return migrationFiles().map((name) => readFileSync(join(MIGRATIONS, name), 'utf8')).join('\n');
}

describe('migration numbering', () => {
  it('gives every migration a unique sequence number', () => {
    // Two branches in flight both claimed 0030. Nothing failed: the second one
    // applied is simply skipped by anything tracking applied migrations by
    // version, and the schema silently lacks whatever it contained. The
    // collision is invisible until something built on it does not work.
    const numbers = migrationFiles().map((name) => name.split('_')[0]);
    const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    assert.deepEqual(duplicates, [], `two migrations claim the same version: ${duplicates.join(', ')}`);
  });

  it('names every migration <version>_<slug>.sql', () => {
    for (const name of migrationFiles()) {
      assert.match(name, /^\d{14}_[a-z0-9_]+\.sql$/, `${name} does not follow the naming rule`);
    }
  });

  it('numbers them in the order they sort, so filename order is apply order', () => {
    const numbers = migrationFiles().map((name) => name.split('_')[0] ?? '');
    assert.deepEqual([...numbers].sort(), numbers);
  });
});

/**
 * The one that keeps coming back.
 *
 * 0014 set `alter default privileges in schema public grant all on tables to
 * authenticated`, and in Postgres that reaches VIEWS. A single-table view of
 * bare column references is automatically updatable, and a view that does not
 * set `security_invoker` runs as its owner — so INSERT, UPDATE and DELETE
 * travel through it, as the owner, outside RLS, against the base table.
 *
 * 0031 found this live on two views (a signed-up user with no brand claim
 * could `delete from public.brand_storefront` and cascade a whole tenant away)
 * and closed them, leaving a comment asking whoever added the next view to do
 * the same. 0033 was the next view; the comment worked. It worked because
 * somebody read it, which is not a property anyone should rely on twice.
 */
describe('no view is a write path', () => {
  const WRITE_REVOKE = (view: string) =>
    new RegExp(`revoke[^;]*\\b(insert|update|delete)\\b[^;]*on\\s+(public\\.)?${view}\\b[^;]*;`, 'is');

  function declaredViews(): string[] {
    const matches = orderedSql().matchAll(/create\s+(?:or\s+replace\s+)?view\s+public\.([a-z_]+)/gi);
    return [...new Set([...matches].map((m) => (m[1] ?? '').toLowerCase()))];
  }

  it('finds views to check, so a broken parser cannot pass vacuously', () => {
    assert.ok(declaredViews().length >= 6, 'expected the tree to declare several views');
  });

  it('revokes insert, update and delete on every view, from every client role', () => {
    const sql = orderedSql();
    for (const view of declaredViews()) {
      const revoke = WRITE_REVOKE(view).exec(sql);
      assert.ok(revoke,
        `public.${view} never has its writes revoked. 0014's default privileges grant `
        + 'ALL on new tables AND VIEWS to authenticated, so this view is a write path '
        + 'into its base table. Add: revoke insert, update, delete on public.'
        + `${view} from anon, authenticated;`);
      for (const role of ['anon', 'authenticated']) {
        assert.match(revoke[0], new RegExp(`\\b${role}\\b`),
          `public.${view} revokes writes but not from ${role}`);
      }
    }
  });

  it('revokes after the last create, because drop+create resets grants', () => {
    // `create or replace view` preserves privileges; `drop view` followed by
    // `create view` does not — the default privileges from 0014 reapply. A
    // revoke written before a later recreate is therefore undone by it.
    const sql = orderedSql();
    for (const view of declaredViews()) {
      // Specifically a CREATE, not any mention: `comment on view public.x` also
      // contains the view's name, and matching it made this assert against the
      // wrong offset. The first version of this test failed on a view that was
      // fine, which is the more expensive kind of wrong.
      const creates = [...sql.matchAll(
        new RegExp(`create\\s+(?:or\\s+replace\\s+)?view\\s+public\\.${view}\\b`, 'gi'),
      )];
      const lastCreate = creates[creates.length - 1]?.index ?? -1;
      const revokes = [...sql.matchAll(new RegExp(WRITE_REVOKE(view).source, 'gis'))];
      const lastRevoke = revokes[revokes.length - 1]?.index ?? -1;
      assert.ok(lastRevoke > lastCreate,
        `public.${view} is recreated after its write revoke, which restores the grant`);
    }
  });
});

describe('typescript strictness is a workspace property, not a per-package one', () => {
  /**
   * `packages/domain`, `packages/data` and `packages/api-client` each carried a
   * hand-rolled tsconfig that happened to omit `noUncheckedIndexedAccess`. They
   * compiled clean in isolation and produced 25 errors the moment a strict app
   * imported them — and every file merged in from a branch written against the
   * looser settings brings more. A shared package must compile at least as
   * strictly as anything that consumes it.
   */
  const WORKSPACES = ['packages', 'apps', 'tests'];

  it('has every workspace tsconfig extend the base', () => {
    const offenders: string[] = [];
    for (const group of WORKSPACES) {
      for (const entry of readdirSync(join(ROOT, group), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const path = join(ROOT, group, entry.name, 'tsconfig.json');
        let raw: string;
        try {
          raw = readFileSync(path, 'utf8');
        } catch {
          continue;
        }
        const extendsBase = /"extends"\s*:\s*"[^"]*tsconfig\.base\.json"/.test(raw);
        // The Expo apps extend expo/tsconfig.base, which is theirs to own; they
        // are pinned here by name so adding a fourth is a deliberate act.
        const expoApp = /"extends"\s*:\s*"expo\/tsconfig\.base"/.test(raw);
        if (!extendsBase && !expoApp) offenders.push(`${group}/${entry.name}`);
      }
    }
    assert.deepEqual(offenders, [],
      `these compile under their own rules rather than the workspace's: ${offenders.join(', ')}`);
  });
});
