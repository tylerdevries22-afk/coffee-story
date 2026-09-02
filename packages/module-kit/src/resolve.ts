/**
 * Turns a set of requested modules into one deterministic, fully-checked
 * resolution.
 *
 * Resolution is where half the module plan's safety lives: unknown keys,
 * unsatisfied version ranges, incompatible pairs, and dependency cycles are
 * all rejected here, before activation ever starts. The output order is a
 * topological sort with alphabetical tie-breaking, so two runs over the same
 * input produce byte-identical snapshots and drift detection stays a plain
 * string compare.
 */
import { dependencySatisfied } from './manifest';
import type { ModuleDefinition } from './types';

export type ResolutionError =
  | { readonly kind: 'unknown-module'; readonly key: string }
  | { readonly kind: 'unknown-dependency'; readonly key: string; readonly dependency: string }
  | { readonly kind: 'version-mismatch'; readonly key: string; readonly dependency: string; readonly wanted: string; readonly found: string }
  | { readonly kind: 'incompatible'; readonly a: string; readonly b: string }
  | { readonly kind: 'cycle'; readonly keys: readonly string[] };

export type ResolutionResult =
  | { readonly kind: 'ok'; readonly modules: readonly ModuleDefinition[] }
  | { readonly kind: 'failed'; readonly errors: readonly ResolutionError[] };

function indexByKey(definitions: readonly ModuleDefinition[]): Map<string, ModuleDefinition> {
  const byKey = new Map<string, ModuleDefinition>();
  for (const definition of definitions) {
    if (!byKey.has(definition.key)) byKey.set(definition.key, definition);
  }
  return byKey;
}

/** Depth-first closure over requested keys, recording every missing link. */
function expand(
  requested: readonly string[],
  byKey: Map<string, ModuleDefinition>,
  errors: ResolutionError[],
): Set<string> {
  const included = new Set<string>();
  const queue: { key: string; via: string | null }[] = requested.map((key) => ({ key, via: null }));
  while (queue.length > 0) {
    const { key, via } = queue.pop() as { key: string; via: string | null };
    if (included.has(key)) continue;
    included.add(key);
    const definition = byKey.get(key);
    if (!definition) {
      errors.push(via === null
        ? { kind: 'unknown-module', key }
        : { kind: 'unknown-dependency', key: via, dependency: key });
      continue;
    }
    for (const dependency of definition.dependencies) {
      queue.push({ key: dependency.key, via: key });
    }
  }
  return included;
}

function checkPairs(
  included: Set<string>,
  byKey: Map<string, ModuleDefinition>,
  errors: ResolutionError[],
): void {
  for (const key of included) {
    const definition = byKey.get(key);
    if (!definition) continue;
    for (const dependency of definition.dependencies) {
      const available = byKey.get(dependency.key);
      if (!available || !included.has(dependency.key)) continue;
      if (!dependencySatisfied(dependency, available)) {
        errors.push({
          kind: 'version-mismatch', key, dependency: dependency.key,
          wanted: dependency.version, found: available.version,
        });
      }
    }
    for (const other of definition.incompatibleWith) {
      if (included.has(other) && key < other) {
        errors.push({ kind: 'incompatible', a: key, b: other });
      }
    }
  }
}

/** Kahn's algorithm; a leftover edge after the pass is a cycle. */
function sortTopologically(
  included: Set<string>,
  byKey: Map<string, ModuleDefinition>,
): { order: ModuleDefinition[]; cycle: string[] } {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const key of included) {
    indegree.set(key, 0);
    const definition = byKey.get(key);
    for (const dependency of definition?.dependencies ?? []) {
      if (!included.has(dependency.key)) continue;
      indegree.set(key, (indegree.get(key) ?? 0) + 1);
      dependents.set(dependency.key, [...(dependents.get(dependency.key) ?? []), key]);
    }
  }
  const ready = [...included].filter((key) => indegree.get(key) === 0).sort();
  const order: ModuleDefinition[] = [];
  while (ready.length > 0) {
    const key = ready.shift() as string;
    const definition = byKey.get(key);
    if (definition) order.push(definition);
    for (const dependent of (dependents.get(key) ?? []).sort()) {
      const next = (indegree.get(dependent) ?? 1) - 1;
      indegree.set(dependent, next);
      if (next === 0) ready.push(dependent);
    }
    ready.sort();
  }
  const cycle = [...included].filter((key) => (indegree.get(key) ?? 0) > 0).sort();
  return { order, cycle };
}

/** Resolves `requested` against the registry. Unknown requests fail the whole resolution. */
export function resolveModules(
  definitions: readonly ModuleDefinition[],
  requested: readonly string[],
): ResolutionResult {
  const byKey = indexByKey(definitions);
  const errors: ResolutionError[] = [];
  const included = expand([...new Set(requested)], byKey, errors);
  checkPairs(included, byKey, errors);
  const { order, cycle } = sortTopologically(included, byKey);
  if (cycle.length > 0) errors.push({ kind: 'cycle', keys: cycle });
  if (errors.length > 0) return { kind: 'failed', errors };
  return { kind: 'ok', modules: order };
}
