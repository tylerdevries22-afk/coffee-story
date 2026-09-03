/**
 * A shallow reader for `create [or replace] function` in a migration file.
 *
 * Enough to recover a function's name, its argument modes, names and types,
 * and its return type -- which is all the replacement rule in
 * function-replacement.ts needs to decide whether PostgreSQL would accept a
 * redefinition. It is not a SQL parser and does not need to be: it never
 * evaluates a body, and the only things it must get right are the argument
 * list and the return clause.
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

const DEFINITION =
  /create\s+(or\s+replace\s+)?function\s+([\w.]+)\s*\(([\s\S]*?)\)\s*returns\s+((?:setof\s+)?[^\s;(]+)/gi;

const MODES = new Set(['in', 'out', 'inout', 'variadic']);

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

