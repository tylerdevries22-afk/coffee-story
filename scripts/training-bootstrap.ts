import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type JsonObject = Record<string, unknown>;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  let finalError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      finalError = new Error(`Platform API returned ${response.status}`);
    } catch (error) {
      finalError = error instanceof Error ? error : new Error('Platform API request failed');
    } finally {
      clearTimeout(timeout);
    }
  }
  throw finalError ?? new Error('Platform API request failed');
}

async function responseJson(response: Response): Promise<JsonObject> {
  const body = await response.json() as JsonObject;
  if (!response.ok) {
    const structured = body.error as { message?: string } | undefined;
    throw new Error(structured?.message ?? `Platform API returned ${response.status}`);
  }
  return body;
}

async function main(): Promise<void> {
  const profilePath = option('--profile');
  const apiUrl = process.env.PLATFORM_API_URL?.replace(/\/$/, '');
  const token = process.env.TENANT_ACCESS_TOKEN;
  if (!profilePath || !apiUrl || !token) {
    throw new Error('Usage: PLATFORM_API_URL=... TENANT_ACCESS_TOKEN=... pnpm training:bootstrap --profile tenant-training.json [--force] [--wait]');
  }
  const profile = JSON.parse(await readFile(resolve(profilePath), 'utf8')) as JsonObject;
  const started = await responseJson(await request(`${apiUrl}/api/training/bootstrap`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify({ profile, force: process.argv.includes('--force') }),
  }));
  process.stdout.write(`${JSON.stringify(started, null, 2)}\n`);
  const runId = typeof started.runId === 'string' ? started.runId : undefined;
  if (!runId || !process.argv.includes('--wait')) return;
  for (;;) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
    const status = await responseJson(await request(`${apiUrl}/api/training/bootstrap/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
    process.stdout.write(`${JSON.stringify(status)}\n`);
    const run = status.run as { status?: string } | undefined;
    if (run?.status && ['published', 'failed', 'cancelled'].includes(run.status)) return;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Training bootstrap failed.';
  process.stderr.write(`${JSON.stringify({ error: { code: 'training_bootstrap_failed', message } })}\n`);
  process.exitCode = 1;
});
