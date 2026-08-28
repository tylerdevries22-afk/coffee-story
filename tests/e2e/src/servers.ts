/**
 * The three app surfaces, self-hosted by the suite: static servers for the
 * two Expo web exports (with the clean-URL -> .html mapping expo-router's
 * static output expects) and `next start` for HQ. Everything binds to
 * localhost and dies with the test process.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import { extname, join, normalize } from 'node:path';

import { stack } from './stack.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json',
};

/** exact file -> path.html -> path/index.html -> the SPA root. */
function resolveFile(root: string, urlPath: string): string | null {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0] ?? '/')).replace(/^(\.\.[/\\])+/, '');
  const candidates = [
    join(root, clean),
    join(root, `${clean}.html`),
    join(root, clean, 'index.html'),
    join(root, 'index.html'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function startStaticServer(root: string, port: number): Promise<() => void> {
  const server = http.createServer((request, response) => {
    const file = resolveFile(root, request.url ?? '/');
    if (!file) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(() => {
      // close() alone leaves keep-alive sockets holding the event loop open.
      server.close();
      server.closeAllConnections();
    }));
  });
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${url} not ready within ${timeoutMs}ms (${lastError})`);
}

export async function startHq(port: number): Promise<() => void> {
  // detached + piped output, and the stop kills the whole process group:
  // `pnpm exec` is only a wrapper, so SIGTERM to the child alone orphans the real
  // next-server grandchild — and with `stdio: inherit` that orphan holds the
  // CI step's output pipe open forever, hanging the job long after the test
  // process has exited. Piping through this process keeps the logs without
  // ever handing the step's pipe to the grandchild.
  const child: ChildProcess = spawn(
    'pnpm',
    ['exec', 'next', 'start', '-p', String(port)],
    {
      cwd: stack.hqDir,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SUPABASE_URL: stack.url,
        SUPABASE_SERVICE_ROLE_KEY: stack.serviceRoleKey,
        NEXT_PUBLIC_SUPABASE_URL: stack.url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
        CRON_SECRET: 'e2e-cron-secret',
      },
    },
  );
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  const stop = () => {
    const pid = child.pid;
    if (!pid) return;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Already gone — the normal case.
      }
    }, 5000).unref();
  };
  try {
    await waitForHttp(`http://127.0.0.1:${port}/api/health`, 60_000);
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
