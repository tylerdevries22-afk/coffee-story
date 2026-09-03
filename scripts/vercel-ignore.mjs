#!/usr/bin/env node
/**
 * Vercel ignored-build helper. Exit 0 skips the build; exit 1 proceeds.
 * Fail open (proceed) when the previous SHA is missing or git fails.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const APPS = new Set(['customer', 'kiosk', 'operator', 'hq', 'display']);

const SHARED_FILES = new Set([
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'tsconfig.base.json',
]);

function underDir(path, dir) {
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return path === prefix.slice(0, -1) || path.startsWith(prefix);
}

export function pathAffectsApp(app, rawPath) {
  const path = String(rawPath).replaceAll('\\', '/').replace(/^\.\//, '');
  if (underDir(path, `apps/${app}/`)) return true;
  if (SHARED_FILES.has(path)) return true;
  if (underDir(path, 'packages/') || underDir(path, 'tenants/') || underDir(path, 'patches/')) {
    return true;
  }
  return app === 'hq' && underDir(path, 'scripts/');
}

export function decideBuild(app, files) {
  const hit = files.find((file) => pathAffectsApp(app, file));
  if (!hit) return { skip: true, reason: `skip ${app}: no relevant changes` };
  return { skip: false, reason: `build ${app}: ${hit}` };
}

function gitExec(args, cwd) {
  return execFileSync('git', args, { encoding: 'utf8', cwd }).trim();
}

export function createGit(exec = gitExec) {
  return {
    toplevel() {
      return exec(['rev-parse', '--show-toplevel']);
    },
    diffNames(prev) {
      const out = exec(['diff', '--name-only', prev, 'HEAD'], this.toplevel());
      return out === '' ? [] : out.split('\n');
    },
  };
}

export function runIgnore({ argv, env, git, log }) {
  const app = argv[2];
  if (!APPS.has(app)) {
    log('build: unknown or missing app');
    return 1;
  }
  const prev = String(env.VERCEL_GIT_PREVIOUS_SHA ?? '').trim();
  if (!prev) {
    log(`build ${app}: missing VERCEL_GIT_PREVIOUS_SHA`);
    return 1;
  }
  return decideFromGit(app, prev, git, log);
}

function decideFromGit(app, prev, git, log) {
  try {
    git.toplevel();
    const decision = decideBuild(app, git.diffNames(prev));
    log(decision.reason);
    return decision.skip ? 0 : 1;
  } catch {
    log(`build ${app}: git failed`);
    return 1;
  }
}

function isCli() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isCli()) {
  const code = runIgnore({
    argv: process.argv,
    env: process.env,
    git: createGit(),
    log: (line) => process.stdout.write(`${line}\n`),
  });
  process.exit(code);
}
