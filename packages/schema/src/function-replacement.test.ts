import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { findReplacementConflicts } from './function-replacement.js';
import {
  parseFunctionDefinitions,
  type FunctionDefinition,
} from './sql-function-parser.js';

/**
 * The migration defect no pull request can currently catch.
 *
 * `create or replace function` cannot rename an input parameter. Postgres
 * raises 42P13 at apply time, and apply time is the only place it shows up:
 * `pnpm verify` runs no database, and `hosted-integration` -- the one job that
 * does -- is gated to non-pull-request events so branch code never holds the
 * project-creation token. A migration with this defect is therefore green on
 * its pull request and red the moment it merges, where it blocks every
 * migration queued behind it as well as its own.
 *
 * This happened. 20260903041500_training_track_slug.sql renamed
 * target_module_slug to target_track_slug under `create or replace`, passed its
 * pull request, and left main unable to migrate a fresh database for six
 * merges. The fix is a `drop function` before the create; this test is what
 * makes the next one fail on the pull request instead.
 */
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');

function allDefinitions(): FunctionDefinition[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .flatMap((name) => parseFunctionDefinitions(name, readFileSync(join(MIGRATIONS, name), 'utf8')));
}

describe('create or replace function', () => {
  it('never changes a parameter name, out-parameter list, or return type', () => {
    const conflicts = findReplacementConflicts(allDefinitions());
    const report = conflicts
      .map(
        (conflict) =>
          `${conflict.name}: ${conflict.reason} changed\n` +
          `      ${conflict.previous.source}: ${conflict.previous.value}\n` +
          `      ${conflict.current.source}: ${conflict.current.value}`,
      )
      .join('\n');
    assert.equal(
      conflicts.length,
      0,
      'PostgreSQL rejects these with 42P13 at apply time. Drop the function ' +
        'before recreating it, and restate its grants -- a drop discards the ACL.\n' +
        report,
    );
  });

  it('reads every migration, so the suite cannot pass by finding nothing', () => {
    const definitions = allDefinitions();
    assert.ok(
      definitions.length > 150,
      `parsed only ${definitions.length} function definitions; the parser has probably broken`,
    );
    assert.ok(definitions.some((definition) => definition.replaces));
  });
});

describe('parseFunctionDefinitions', () => {
  it('reads modes, names and types, and defaults an unmarked argument to in', () => {
    const [definition] = parseFunctionDefinitions(
      'x.sql',
      'create function app.f(a uuid, variadic b text[], out c int) returns void as $$ $$;',
    );
    assert.deepEqual(definition?.args, [
      { mode: 'in', name: 'a', type: 'uuid' },
      { mode: 'variadic', name: 'b', type: 'text[]' },
      { mode: 'out', name: 'c', type: 'int' },
    ]);
    assert.equal(definition?.replaces, false);
  });

  it('keeps a parenthesised type together and drops a default expression', () => {
    const [definition] = parseFunctionDefinitions(
      'x.sql',
      'create function app.f(a numeric(10, 2), b text default \'x, y\') returns void as $$ $$;',
    );
    assert.deepEqual(definition?.args, [
      { mode: 'in', name: 'a', type: 'numeric(10, 2)' },
      { mode: 'in', name: 'b', type: 'text' },
    ]);
  });

  it('treats a lone token as an unnamed type, which is legal', () => {
    const [definition] = parseFunctionDefinitions(
      'x.sql',
      'create function app.f(text) returns void as $$ $$;',
    );
    assert.deepEqual(definition?.args, [{ mode: 'in', name: null, type: 'text' }]);
  });

  it('ignores DDL quoted inside a comment', () => {
    const definitions = parseFunctionDefinitions(
      'x.sql',
      '-- create or replace function app.ghost(a uuid) returns void\ncreate function app.real() returns void as $$ $$;',
    );
    assert.deepEqual(
      definitions.map((definition) => definition.name),
      ['app.real'],
    );
  });
});

describe('findReplacementConflicts', () => {
  const base = (over: Partial<FunctionDefinition> = {}): FunctionDefinition => ({
    source: '1.sql',
    name: 'app.f',
    replaces: false,
    args: [{ mode: 'in', name: 'a', type: 'uuid' }],
    returns: 'void',
    ...over,
  });

  it('reports a renamed input parameter', () => {
    const conflicts = findReplacementConflicts([
      base(),
      base({ source: '2.sql', replaces: true, args: [{ mode: 'in', name: 'b', type: 'uuid' }] }),
    ]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.reason, 'parameter name');
    assert.equal(conflicts[0]?.previous.source, '1.sql');
    assert.equal(conflicts[0]?.current.source, '2.sql');
  });

  it('reports a changed return type', () => {
    const conflicts = findReplacementConflicts([
      base(),
      base({ source: '2.sql', replaces: true, returns: 'boolean' }),
    ]);
    assert.equal(conflicts[0]?.reason, 'return type');
  });

  it('reports a changed out-parameter name', () => {
    const withOut = [{ mode: 'in', name: 'a', type: 'uuid' }, { mode: 'out', name: 'x', type: 'int' }] as const;
    const conflicts = findReplacementConflicts([
      base({ args: withOut }),
      base({
        source: '2.sql',
        replaces: true,
        args: [{ mode: 'in', name: 'a', type: 'uuid' }, { mode: 'out', name: 'y', type: 'int' }],
      }),
    ]);
    assert.equal(conflicts[0]?.reason, 'out parameters');
  });

  it('accepts a rename that is a plain create, since a drop must have preceded it', () => {
    const conflicts = findReplacementConflicts([
      base(),
      base({ source: '2.sql', replaces: false, args: [{ mode: 'in', name: 'b', type: 'uuid' }] }),
    ]);
    assert.deepEqual(conflicts, []);
  });

  it('does not confuse two overloads of the same name', () => {
    const conflicts = findReplacementConflicts([
      base(),
      base({ source: '2.sql', replaces: true, args: [{ mode: 'in', name: 'b', type: 'text' }] }),
    ]);
    assert.deepEqual(conflicts, []);
  });

  it('ignores an out-parameter change when the input names already differ', () => {
    const conflicts = findReplacementConflicts([
      base(),
      base({ source: '2.sql', replaces: true, args: [{ mode: 'in', name: 'b', type: 'uuid' }], returns: 'boolean' }),
    ]);
    assert.equal(conflicts.length, 1, 'one conflict per redefinition, not one per difference');
  });
});
