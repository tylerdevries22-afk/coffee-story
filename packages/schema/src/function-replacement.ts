/**
 * What PostgreSQL will refuse to do to a function that already exists.
 *
 * `create or replace function` is not a general redefinition. Postgres rejects
 * it outright when the new definition changes an input parameter's *name*
 * (`cannot change name of input parameter`, 42P13), changes the OUT-parameter
 * list, or changes the return type. Parameter names are no part of a function's
 * identity for overload resolution, which is exactly why this surprises people:
 * the signature is unchanged, the migration reads correctly, and it still
 * fails.
 *
 * It fails at apply time, against a real database. Nothing in `pnpm verify`
 * touches a database, and the hosted integration job is gated to non-pull-request
 * events, so a migration carrying this defect passes every check a pull request
 * runs and only breaks after it reaches main -- where it blocks not just itself
 * but every migration behind it. This module makes the check static so it runs
 * on the pull request instead.
 *
 * The parse is deliberately shallow: enough to recover a function's name, its
 * argument modes, names and types, and its return type. It is not a SQL parser
 * and does not need to be.
 */

/** One parameter of a function definition, as written in the migration. */
export type FunctionArgument = {
  readonly mode: 'in' | 'out' | 'inout' | 'variadic';
  /** `null` for a type-only argument, which is legal and unnamed. */
  readonly name: string | null;
  readonly type: string;
};

/** A single `create [or replace] function` occurrence. */
export type FunctionDefinition = {
  readonly source: string;
  readonly name: string;
  readonly replaces: boolean;
  readonly args: readonly FunctionArgument[];
  readonly returns: string;
};

/** A redefinition PostgreSQL would reject. */
export type ReplacementConflict = {
  readonly name: string;
  readonly reason: 'parameter name' | 'out parameters' | 'return type';
  readonly previous: { readonly source: string; readonly value: string };
  readonly current: { readonly source: string; readonly value: string };
};

const DEFINITION =
  /create\s+(or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns\s+((?:setof\s+)?[^\s;(]+)/gi;

const MODES = new Set(['in', 'out', 'inout', 'variadic']);
const INPUT_MODES = new Set(['in', 'inout', 'variadic']);
const OUTPUT_MODES = new Set(['out', 'inout']);

/**
 * Drop `--` comments before parsing.
 *
 * Migrations in this repo carry long explanatory comments, and several of them
 * quote the DDL they are describing. Parsing those quotes as real definitions
 * would report conflicts against statements that never run.
 */
function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/**
 * Split an argument list on top-level commas.
 *
 * Both exclusions are real: `numeric(10, 2)` puts a comma inside parentheses,
 * and `default 'a, b'` puts one inside a string literal. Postgres escapes a
 * quote by doubling it, which needs no special case here -- the first quote
 * closes the literal and the second immediately reopens it, so the parity ends
 * up right either way.
 */
function splitArguments(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const char of list) {
    if (char === "'") quoted = !quoted;
    if (!quoted) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (char === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function parseArgument(raw: string): FunctionArgument | null {
  const withoutDefault = raw.split(/\s+default\s+|\s*=\s*/i)[0]?.trim() ?? '';
  const tokens = withoutDefault.split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return null;

  let mode: FunctionArgument['mode'] = 'in';
  let rest = tokens;
  const leading = tokens[0]?.toLowerCase() ?? '';
  if (MODES.has(leading)) {
    mode = leading as FunctionArgument['mode'];
    rest = tokens.slice(1);
  }
  if (rest.length === 0) return null;
  // A lone token is a type, not a name: `create function f(text)` is legal.
  if (rest.length === 1) {
    return { mode, name: null, type: rest[0]?.toLowerCase() ?? '' };
  }
  return {
    mode,
    name: rest[0]?.toLowerCase() ?? null,
    type: rest.slice(1).join(' ').toLowerCase(),
  };
}

/** Every function definition in one migration file. */
export function parseFunctionDefinitions(source: string, sql: string): FunctionDefinition[] {
  const found: FunctionDefinition[] = [];
  const body = withoutComments(sql);
  for (const match of body.matchAll(DEFINITION)) {
    const args = splitArguments(match[3] ?? '')
      .map(parseArgument)
      .filter((arg): arg is FunctionArgument => arg !== null);
    found.push({
      source,
      name: (match[2] ?? '').toLowerCase(),
      replaces: Boolean(match[1]),
      args,
      returns: (match[4] ?? '').toLowerCase().replace(/\s+/g, ' '),
    });
  }
  return found;
}

/** The overload identity: name plus input types, which is what Postgres matches on. */
function identity(definition: FunctionDefinition): string {
  const types = definition.args
    .filter((arg) => INPUT_MODES.has(arg.mode))
    .map((arg) => arg.type);
  return `${definition.name}(${types.join(',')})`;
}

function inputNames(definition: FunctionDefinition): string {
  return definition.args
    .filter((arg) => INPUT_MODES.has(arg.mode))
    .map((arg) => arg.name ?? '?')
    .join(', ');
}

function outputNames(definition: FunctionDefinition): string {
  return definition.args
    .filter((arg) => OUTPUT_MODES.has(arg.mode))
    .map((arg) => arg.name ?? '?')
    .join(', ');
}

/**
 * Replay definitions in migration order and report the redefinitions Postgres
 * would reject.
 *
 * `definitions` must arrive in the order the migrations apply. Only a
 * definition carrying `or replace` can conflict: a bare `create function`
 * against a live name fails for a different reason, and one preceded by a
 * `drop function` -- the correct way to rename a parameter -- is a fresh
 * create and resets the comparison.
 */
export function findReplacementConflicts(
  definitions: readonly FunctionDefinition[],
): ReplacementConflict[] {
  const live = new Map<string, FunctionDefinition>();
  const conflicts: ReplacementConflict[] = [];

  for (const definition of definitions) {
    const key = identity(definition);
    const previous = live.get(key);
    if (previous && definition.replaces) {
      const checks = [
        { reason: 'parameter name', read: inputNames },
        { reason: 'out parameters', read: outputNames },
        { reason: 'return type', read: (d: FunctionDefinition) => d.returns },
      ] as const;
      for (const check of checks) {
        const before = check.read(previous);
        const after = check.read(definition);
        if (before === after) continue;
        conflicts.push({
          name: key,
          reason: check.reason,
          previous: { source: previous.source, value: before },
          current: { source: definition.source, value: after },
        });
        break;
      }
    }
    live.set(key, definition);
  }
  return conflicts;
}
