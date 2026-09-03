/**
 * What PostgreSQL will refuse to do to a function that already exists.
 *
 * `create or replace function` is not a general redefinition. Postgres rejects
 * it outright when the new definition changes an input parameter's *name*
 * (`cannot change name of input parameter`, 42P13), changes the OUT-parameter
 * list, or changes the return type. Parameter names are no part of a
 * function's identity for overload resolution, which is exactly why this
 * surprises people: the signature is unchanged, the migration reads correctly,
 * and it still fails.
 *
 * It fails at apply time, against a real database. Nothing in `pnpm verify`
 * touches a database, and the hosted integration job is gated to
 * non-pull-request events, so a migration carrying this defect passes every
 * check a pull request runs and only breaks after it reaches main -- where it
 * blocks not just itself but every migration behind it. This module makes the
 * check static so it runs on the pull request instead.
 *
 * The reading is sql-function-parser.ts; this file is only the rule.
 */
import type { FunctionDefinition } from './sql-function-parser.js';

/** A redefinition PostgreSQL would reject. */
export type ReplacementConflict = {
  readonly name: string;
  readonly reason: 'parameter name' | 'out parameters' | 'return type';
  readonly previous: { readonly source: string; readonly value: string };
  readonly current: { readonly source: string; readonly value: string };
};

const INPUT_MODES = new Set(['in', 'inout', 'variadic']);
const OUTPUT_MODES = new Set(['out', 'inout']);

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
