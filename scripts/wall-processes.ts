import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

type Result = { code: number | null; reason: string };
export type WallProcess = {
  name: string;
  child: ChildProcess;
  exited: Promise<Result>;
  result?: Result;
};

function signalTree(child: ChildProcess, signal: NodeJS.Signals | 0): boolean {
  if (!child.pid) return false;
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    // An existence probe may report EPERM while macOS is reaping the group.
    if (signal === 0 && code === 'EPERM') return true;
    throw error;
  }
}

/** Owns only processes spawned by this launcher, including pnpm's descendants. */
export class WallProcesses {
  private readonly processes: WallProcess[] = [];

  constructor(private readonly root: string, private readonly signal: AbortSignal) {}

  start(name: string, executable: string, args: readonly string[], env = {}): WallProcess {
    this.signal.throwIfAborted();
    if (process.platform === 'win32') {
      throw new Error('The wall launcher requires POSIX process groups (macOS, Linux, or WSL).');
    }
    const child = spawn(executable, [...args], {
      cwd: this.root, stdio: 'inherit', detached: true, env: { ...process.env, ...env },
    });
    const managed: WallProcess = {
      name, child,
      exited: new Promise((resolve) => {
        const finish = (result: Result) => {
          if (managed.result) return;
          managed.result = result;
          resolve(result);
        };
        child.once('error', (error) => finish({ code: null, reason: error.message }));
        child.once('exit', (code, signal) => finish({ code, reason: String(signal ?? code) }));
      }),
    };
    this.processes.push(managed);
    return managed;
  }

  async run(executable: string, args: readonly string[]): Promise<void> {
    const managed = this.start(executable, executable, args);
    let abort: () => void = () => undefined;
    try {
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(this.signal.reason);
        this.signal.addEventListener('abort', abort, { once: true });
      });
      const result = await Promise.race([managed.exited, cancelled]);
      if (result.code !== 0) throw new Error(`${executable} failed (${result.reason}).`);
    } finally {
      this.signal.removeEventListener('abort', abort);
      await this.stopEntries([managed], 5_000);
      this.processes.splice(this.processes.indexOf(managed), 1);
    }
  }

  async stop(graceMs = 5_000): Promise<void> {
    await this.stopEntries(this.processes.splice(0), graceMs);
  }

  private async stopEntries(processes: readonly WallProcess[], graceMs: number): Promise<void> {
    // The wrapper may already have exited while its server descendants are alive.
    // Retire finished command IDs immediately; never retain them for a long preview session.
    const active = processes.filter(({ child }) => signalTree(child, 'SIGTERM'));
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && active.some(({ child }) => signalTree(child, 0))) {
      await delay(25);
    }
    for (const { child } of active) signalTree(child, 'SIGKILL');
    await Promise.all(processes.map(({ exited }) => exited));
  }
}
