import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import type { WallLaunch } from './wall-launch-config';
import type { WallProcess } from './wall-processes';

export async function assertPortsAvailable(targets: readonly WallLaunch[]): Promise<void> {
  for (const { name, port } of targets) {
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once('error', () => reject(new Error(
        `${name}: port ${port} is unavailable. Stop the existing listener before launching; it was left untouched.`,
      )));
      server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()));
    });
  }
}

async function healthy(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(url, {
      redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
    });
    if (response.status < 200 || response.status >= 400) {
      await response.body?.cancel();
      return false;
    }
    // Next streams a loading shell before its page is ready; headers alone are insufficient.
    await response.arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

export async function waitForHealth(
  targets: readonly WallLaunch[], processes: readonly WallProcess[], signal: AbortSignal,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let missing = targets;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const failed = processes.find(({ result }) => result !== undefined);
    if (failed) throw new Error(`${failed.name} exited (${failed.result?.reason}).`);
    const checks = await Promise.all(missing.map(async (target) => ({
      target, ready: await healthy(target.url, signal),
    })));
    signal.throwIfAborted();
    missing = checks.filter(({ ready }) => !ready).map(({ target }) => target);
    if (missing.length === 0) return;
    await delay(400, undefined, { signal });
  }
  throw new Error(`Wall startup timed out waiting for ${missing.map(({ name }) => name).join(', ')}.`);
}
