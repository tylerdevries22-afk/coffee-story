/**
 * A workflow function's bundle cannot use Node builtins.
 *
 * `next build` enforces this through the workflow plugin, and the failure is
 * expensive to discover: it arrives at the END of `pnpm verify`
 * (lint && typecheck && test && build), so anything that fails earlier hides
 * it entirely. That is exactly what happened -- a file over the 200-line limit
 * failed the test step for long enough that the build had never once run, and
 * the workflow body had been importing `@platform/factory` the whole time.
 * Its barrel re-exports ./tenant-package, which uses node:crypto and node:path,
 * and the build reported 27 errors the moment the earlier gate went green.
 *
 * This is the same rule, checked in the test step where it is cheap.
 *
 * Type-only imports are ignored on purpose: they are erased before bundling,
 * which is why tenant-training-bootstrap can name @platform/domain and build.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const WORKFLOW_DIRECTORIES = [join(ROOT, 'apps', 'hq', 'workflows')];

function typescriptFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
    }
  };
  walk(directory);
  return found;
}

/** Files carrying the workflow directive, whose bundle the plugin restricts. */
function workflowFiles(): string[] {
  return WORKFLOW_DIRECTORIES
    .flatMap(typescriptFiles)
    .filter((file) => /'use workflow'/.test(readFileSync(file, 'utf8')));
}

/**
 * Workspace packages this file imports for their VALUES.
 *
 * `import type { X }` and `import { type X }` are erased, so neither reaches a
 * bundle. A mixed import that names even one value specifier counts.
 */
function valueImportedPackages(source: string): string[] {
  const packages = new Set<string>();
  const pattern = /import\s+(type\s+)?([\s\S]*?)\s*from\s*'(@platform\/[a-z0-9-]+)'/g;
  for (const match of source.matchAll(pattern)) {
    const [, typeOnlyKeyword, clause, specifier] = match;
    if (typeOnlyKeyword) continue;
    const inner = clause?.trim() ?? '';
    // A brace clause where every specifier is `type X` is erased as well.
    if (inner.startsWith('{') && inner.endsWith('}')) {
      const specifiers = inner.slice(1, -1).split(',').map((entry) => entry.trim()).filter(Boolean);
      if (specifiers.length > 0 && specifiers.every((entry) => entry.startsWith('type '))) continue;
    }
    if (specifier) packages.add(specifier);
  }
  return [...packages];
}

/** Non-test source files of a workspace package that name a Node builtin. */
function nodeBuiltinFiles(packageName: string): string[] {
  const directory = join(ROOT, 'packages', packageName.replace('@platform/', ''), 'src');
  return typescriptFiles(directory)
    .filter((file) => /from\s*'node:|require\('node:/.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(ROOT.length + 1));
}

describe('workflow bundles stay free of Node builtins', () => {
  /** A guard that finds no workflow files would pass forever. */
  it('finds the workflow entry points it is meant to check', () => {
    const files = workflowFiles();
    assert.ok(files.length >= 1,
      `no 'use workflow' file found under ${WORKFLOW_DIRECTORIES.join(', ')}`);
    assert.ok(files.some((file) => file.endsWith('platform-factory.ts')),
      'platform-factory.ts is the factory workflow entry point and must be among the checked files');
  });

  it('imports no workspace package whose sources reach node: builtins', () => {
    const offences: string[] = [];
    for (const file of workflowFiles()) {
      const relative = file.slice(ROOT.length + 1);
      for (const packageName of valueImportedPackages(readFileSync(file, 'utf8'))) {
        const builtins = nodeBuiltinFiles(packageName);
        if (builtins.length > 0) {
          offences.push(
            `${relative} imports ${packageName} for its values, and that package reaches Node `
            + `builtins in ${builtins.slice(0, 3).join(', ')}`
            + (builtins.length > 3 ? ` (+${builtins.length - 3} more)` : ''),
          );
        }
      }
    }
    assert.deepEqual(offences, [],
      'a workflow bundle cannot use Node builtins. Move the call into a step module '
      + "(a function carrying 'use step'), which bundles separately, or import the specific "
      + 'module rather than the package barrel.');
  });

  /**
   * Pins the hazard this test exists for. @platform/factory's barrel re-exports
   * ./tenant-package, which needs node:crypto and node:path. If that stops
   * being true the rule above goes quiet, and this says so rather than leaving
   * a green test that checks nothing.
   */
  it('still recognises @platform/factory as reaching Node builtins', () => {
    assert.ok(nodeBuiltinFiles('@platform/factory').length > 0,
      '@platform/factory no longer reaches node: builtins -- re-read this file and decide '
      + 'whether the rule above still has anything to catch');
  });
});
