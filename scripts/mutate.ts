/**
 * A focused mutation tester.
 *
 * A passing suite proves the tests ran, not that they would notice if the code
 * were wrong. This rewrites one operator at a time in a target file, re-runs
 * that package's tests, and reports every mutant the suite failed to kill.
 *
 * It is deliberately small and deliberately narrow. Stryker would mean a second
 * runner, a second config surface and a second notion of what a test is, for a
 * repo whose tests are `node:test` through `tsx`; and mutating the whole
 * monorepo would produce a number nobody reads. The targets that matter are
 * the ones where a silent wrong answer is a security or money bug --
 * authorization, tenancy, order state, device credentials, the release gate.
 *
 * Mutants are applied to the file on disk because that is what the test runner
 * imports. The original text is held in memory and restored in a finally block
 * and on every terminating signal, so an interrupt cannot leave a mutated file
 * behind. Run it on a clean tree; it says so and refuses otherwise.
 *
 *   pnpm mutate --package packages/schema --target src/claims.ts
 *   pnpm mutate --package apps/hq --target lib/device-admin.ts --timeout 180000
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { mutantsFor, type Mutant } from './mutate-analysis.js';

type Options = {
  packageDir: string;
  targets: string[];
  timeout: number;
};

function parseArgs(argv: string[]): Options {
  const options: Options = { packageDir: '', targets: [], timeout: 120_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const takesValue = flag === '--package' || flag === '--target' || flag === '--timeout';
    if (!takesValue) throw new Error(`Unknown argument: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${flag} needs a value.`);
    i += 1;
    if (flag === '--package') options.packageDir = value;
    else if (flag === '--target') options.targets.push(value);
    else options.timeout = Number(value);
  }
  if (!options.packageDir) throw new Error('--package is required.');
  if (options.targets.length === 0) throw new Error('At least one --target is required.');
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
    throw new Error('--timeout must be a positive number of milliseconds.');
  }
  return options;
}

const repoRoot = path.resolve(import.meta.dirname, '..');

/**
 * Runs the package's own test script. Exit status is the verdict: non-zero, or
 * killed by the timeout, means the suite noticed. A timeout counts as killed
 * because a mutant that hangs the suite is one a person would also notice.
 */
function suiteNoticed(packageDir: string, timeout: number): boolean {
  const result = spawnSync('pnpm', ['run', 'test'], {
    cwd: path.join(repoRoot, packageDir),
    timeout,
    stdio: 'ignore',
    encoding: 'utf8',
  });
  return result.status !== 0 || result.signal !== null || result.error !== undefined;
}

function assertCleanTree(files: string[]): void {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', ...files], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  if (dirty) {
    throw new Error(
      `Refusing to run: these targets have uncommitted changes, and a crash would be\n`
      + `indistinguishable from your own edits.\n${dirty}`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const absolute = options.targets.map((target) => path.join(repoRoot, options.packageDir, target));
  const relative = absolute.map((file) => path.relative(repoRoot, file));

  assertCleanTree(relative);

  const originals = new Map(absolute.map((file) => [file, readFileSync(file, 'utf8')]));
  const restore = () => {
    for (const [file, text] of originals) writeFileSync(file, text);
  };
  // An interrupt must not leave a mutated file on disk.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => { restore(); process.exit(130); });
  }

  let survivors = 0;
  let total = 0;

  try {
    process.stdout.write(`baseline: running ${options.packageDir} tests unmutated... `);
    if (suiteNoticed(options.packageDir, options.timeout)) {
      throw new Error('the suite fails before any mutation, so nothing it says is evidence.');
    }
    process.stdout.write('green\n\n');

    for (const file of absolute) {
      const original = originals.get(file) ?? '';
      const source = ts.createSourceFile(file, original, ts.ScriptTarget.ESNext, true);
      const mutants = mutantsFor(source);
      const name = path.relative(repoRoot, file);

      process.stdout.write(`${name}: ${mutants.length} mutants\n`);
      const escaped: Mutant[] = [];

      for (const [index, mutant] of mutants.entries()) {
        writeFileSync(
          file,
          original.slice(0, mutant.start) + mutant.replacement + original.slice(mutant.end),
        );
        const killed = suiteNoticed(options.packageDir, options.timeout);
        if (!killed) escaped.push(mutant);
        process.stdout.write(`\r  ${index + 1}/${mutants.length}  survived: ${escaped.length}  `);
      }
      writeFileSync(file, original);

      total += mutants.length;
      survivors += escaped.length;
      process.stdout.write('\n');

      if (escaped.length === 0) {
        process.stdout.write('  every mutant killed\n\n');
        continue;
      }
      for (const mutant of escaped) {
        const shown = mutant.replacement === '' ? '(removed)' : mutant.replacement;
        process.stdout.write(
          `  survived ${name}:${mutant.line}  [${mutant.operator}] `
          + `${JSON.stringify(mutant.original)} -> ${JSON.stringify(shown)}\n`,
        );
      }
      process.stdout.write('\n');
    }
  } finally {
    restore();
  }

  const killed = total - survivors;
  const score = total === 0 ? 100 : Math.round((killed / total) * 1000) / 10;
  process.stdout.write(`${killed}/${total} mutants killed (${score}%)\n`);
  if (survivors > 0) {
    process.stdout.write(
      'A survivor is not automatically a missing test: some are equivalent mutants that\n'
      + 'cannot change behaviour. Read each one before adding a test for it.\n',
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
