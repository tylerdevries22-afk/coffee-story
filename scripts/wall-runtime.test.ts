import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it, type TestContext } from 'node:test';

import { assertPortsAvailable, waitForHealth } from './wall-health';
import type { WallLaunch } from './wall-launch-config';
import { WallProcesses } from './wall-processes';

function target(port: number): WallLaunch {
  return { name: `test-${port}`, port, url: `http://127.0.0.1:${port}/`,
    executable: process.execPath, args: [], env: {} };
}

async function server(t: TestContext, failures = 0, delayMs = 0) {
  let requests = 0;
  let completed = 0;
  const instance = createServer((_request, response) => {
    response.statusCode = requests++ < failures ? 503 : 200;
    response.flushHeaders();
    setTimeout(() => { completed += 1; response.end('test app'); }, delayMs);
  });
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    instance.closeAllConnections();
    instance.close((error) => error ? reject(error) : resolve());
  }));
  const address = instance.address();
  assert.ok(address && typeof address === 'object');
  return { target: target(address.port), requests: () => requests, completed: () => completed };
}

function owner(t: TestContext) {
  const controller = new AbortController();
  const processes = new WallProcesses(process.cwd(), controller.signal);
  t.after(() => processes.stop(100));
  return { controller, processes };
}

describe('wall health and port safety', () => {
  it('waits for a streamed page body, not just successful headers', async (t) => {
    const live = await server(t, 0, 100);
    await waitForHealth([live.target], [], new AbortController().signal);
    assert.equal(live.completed(), 1);
  });

  it('rejects an occupied port without touching its listener', async (t) => {
    const live = await server(t);
    await assert.rejects(assertPortsAvailable([live.target]), /left untouched/);
    await waitForHealth([live.target], [], new AbortController().signal);
    assert.equal(live.requests(), 1);
  });

  it('retries unhealthy responses and checks all five targets', async (t) => {
    const live = await Promise.all(Array.from({ length: 5 }, () => server(t, 1)));
    await waitForHealth(live.map((entry) => entry.target), [], new AbortController().signal);
    assert.ok(live.every((entry) => entry.requests() === 2));
  });

  it('reports an unavailable app and honors cancellation', async (t) => {
    const live = await server(t, Infinity);
    await assert.rejects(waitForHealth([live.target], [], new AbortController().signal, 20), /timed out/);
    const controller = new AbortController();
    const waiting = waitForHealth([live.target], [], controller.signal);
    controller.abort(new Error('cancel startup'));
    await assert.rejects(waiting, /cancel startup|aborted/);
  });
});

describe('owned wall process lifecycle', { skip: process.platform === 'win32' }, () => {
  it('handles successful commands, nonzero exits, and missing executables', async (t) => {
    const { processes } = owner(t);
    await processes.run(process.execPath, ['-e', 'process.exit(0)']);
    await assert.rejects(processes.run(process.execPath, ['-e', 'process.exit(7)']), /failed \(7\)/);
    await assert.rejects(processes.run('/missing/wall-test-executable', []), /ENOENT/);
  });

  it('cancels an in-progress build and refuses further starts', async (t) => {
    const { controller, processes } = owner(t);
    const running = processes.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    controller.abort(new Error('cancel build'));
    await assert.rejects(running, /cancel build/);
    assert.throws(() => processes.start('later', process.execPath, []), /cancel build/);
    await processes.stop(100);
  });

  it('reports a child exit during readiness checks', async (t) => {
    const { controller, processes } = owner(t);
    const child = processes.start('failed-app', process.execPath, ['-e', 'process.exit(9)']);
    await child.exited;
    await assert.rejects(waitForHealth([], [child], controller.signal), /failed-app exited \(9\)/);
  });

  it('terminates descendants even after their wrapper exits', { timeout: 10_000 }, async (t) => {
    const { processes } = owner(t);
    const directory = mkdtempSync(join(tmpdir(), 'wall-process-test-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const marker = join(directory, 'ready.json');
    const childScript = `
      process.on('SIGTERM', () => {});
      require('node:http').createServer((req, res) => res.end('child')).listen(0, '127.0.0.1', function () {
        require('node:fs').writeFileSync(${JSON.stringify(marker)}, JSON.stringify({port: this.address().port}));
      });
    `;
    const wrapper = processes.start('wrapper', process.execPath, ['-e', `
      const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {stdio: 'ignore'});
      child.unref();
    `]);
    await wrapper.exited;
    const deadline = Date.now() + 5_000;
    while (!existsSync(marker) && Date.now() < deadline) await delay(20);
    assert.ok(existsSync(marker), 'descendant should start');
    const { port } = JSON.parse(readFileSync(marker, 'utf8')) as { port: number };
    await processes.stop(100);
    // Give the OS time to reap the killed descendant and release its socket.
    for (let attempt = 0; ; attempt += 1) {
      try { await assertPortsAvailable([target(port)]); break; }
      catch (error) { if (attempt === 20) throw error; await delay(25); }
    }
  });
});
