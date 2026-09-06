import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

import {
  parseWallLauncherArgs,
  previewCommandArgs,
  readBuiltTenant,
  wallLaunchPlan,
  type WallLaunch,
} from './wall-launch-config';

const ROOT = process.cwd();
const STARTUP_TIMEOUT_MS = 60_000;
const HEALTH_ATTEMPT_MS = 2_000;
const HEALTH_RETRY_MS = 400;

type StartedWall = {
  target: WallLaunch;
  child: ChildProcess;
  exited: Promise<string>;
  exitReason?: string;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function run(executable: string, args: readonly string[]): Promise<void> {
  const child = spawn(executable, [...args], { cwd: ROOT, stdio: 'inherit', env: process.env });
  const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
  if (code !== 0) {
    throw new Error(`${executable} ${args.join(' ')} failed (${signal ?? code ?? 'unknown'}).`);
  }
}

async function healthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(HEALTH_ATTEMPT_MS),
    });
    return response.status >= 200 && response.status < 400;
  } catch {
    return false;
  }
}

function start(target: WallLaunch): StartedWall {
  const child = spawn(target.executable, [...target.args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...target.env },
  });
  const started: StartedWall = {
    target,
    child,
    exited: new Promise((resolve) => {
      let settled = false;
      const finish = (reason: string) => {
        if (settled) return;
        settled = true;
        started.exitReason = reason;
        resolve(reason);
      };
      child.once('error', (error) => finish(error.message));
      child.once('exit', (code, signal) => finish(String(signal ?? code ?? 'unknown')));
    }),
  };
  return started;
}

async function waitForHealth(
  targets: readonly WallLaunch[],
  started: readonly StartedWall[],
): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let missing = targets;
  while (Date.now() < deadline) {
    const failed = started.find(({ exitReason }) => exitReason !== undefined);
    if (failed) throw new Error(`${failed.target.name} exited (${failed.exitReason}).`);
    const checks = await Promise.all(missing.map(async (target) => ({
      target, ready: await healthy(target.url),
    })));
    missing = checks.filter(({ ready }) => !ready).map(({ target }) => target);
    if (missing.length === 0) return;
    await delay(HEALTH_RETRY_MS);
  }
  throw new Error(`Wall startup timed out waiting for ${missing.map(({ name }) => name).join(', ')}.`);
}

async function stop(started: readonly StartedWall[]): Promise<void> {
  const active = started.map(({ child }) => child)
    .filter((child) => child.exitCode === null && child.signalCode === null);
  for (const child of active) child.kill('SIGTERM');
  await Promise.race([
    Promise.all(active.map((child) => once(child, 'exit'))),
    delay(5_000),
  ]);
  for (const child of active) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

async function main(): Promise<void> {
  const options = parseWallLauncherArgs(process.argv.slice(2), process.env.EXPO_PUBLIC_TENANT);
  const builtTenant = readBuiltTenant(ROOT);
  const tenant = options.requestedTenant ?? builtTenant;
  if (!tenant) {
    throw new Error('Pass --tenant <slug> the first time the wall is launched.');
  }

  await run('pnpm', previewCommandArgs(tenant, builtTenant, options.rebuild));
  const plan = wallLaunchPlan(ROOT, tenant);
  const checks = await Promise.all(plan.map(async (target) => ({
    target, ready: await healthy(target.url),
  })));
  const missing = checks.filter(({ ready }) => !ready).map(({ target }) => target);
  const started = missing.map(start);
  try {
    await waitForHealth(plan, started);
    console.log(`\nFive-app wall ready for ${tenant}: http://127.0.0.1:4170/wall`);
    for (const target of plan) console.log(`  ${target.name.padEnd(14)} ${target.url}`);
    if (started.length === 0) return;

    let stopping = false;
    const shutdown = new Promise<void>((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    const failure = Promise.race(started.map(async ({ target, exited }) => {
      const reason = await exited;
      if (!stopping) {
        throw new Error(`${target.name} exited (${reason}).`);
      }
    }));
    await Promise.race([shutdown, failure]);
    stopping = true;
  } finally {
    await stop(started);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
