/**
 * Model B guest surfaces: export Expo web apps with path prefixes into HQ public/.
 * HQ remains the org web host; /customer /kiosk /operator are co-located static apps.
 * Display stays on its own Next deployment until Vercel Services can host two Next apps.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const HQ_PUBLIC = join(ROOT, 'apps', 'hq', 'public');

type Surface = { app: 'customer' | 'kiosk' | 'operator'; baseUrl: string };

const SURFACES: readonly Surface[] = [
  { app: 'customer', baseUrl: '/customer' },
  { app: 'kiosk', baseUrl: '/kiosk' },
  { app: 'operator', baseUrl: '/operator' },
];

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code})`));
    });
  });
}

function withOperatorBaseUrl(baseUrl: string): () => void {
  const path = join(ROOT, 'apps', 'operator', 'app.json');
  const original = readFileSync(path, 'utf8');
  const parsed = JSON.parse(original) as { expo: { experiments?: Record<string, unknown> } };
  parsed.expo.experiments = { ...(parsed.expo.experiments ?? {}), baseUrl };
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
  return () => writeFileSync(path, original);
}

async function exportSurface(surface: Surface, tenant: string): Promise<void> {
  const appRoot = join(ROOT, 'apps', surface.app);
  const outDir = join(appRoot, 'dist-web-org');
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  const restore = surface.app === 'operator' ? withOperatorBaseUrl(surface.baseUrl) : () => undefined;
  try {
    await run(
      'pnpm',
      ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', 'dist-web-org'],
      appRoot,
      {
        ...process.env,
        EXPO_PUBLIC_TENANT: tenant,
        EXPO_BASE_URL: surface.baseUrl,
      },
    );
  } finally {
    restore();
  }
  const target = join(HQ_PUBLIC, surface.app);
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mkdirSync(HQ_PUBLIC, { recursive: true });
  cpSync(outDir, target, { recursive: true });
  console.log(`Published ${surface.app} → apps/hq/public${surface.baseUrl}`);
}

export function requiredTenant(): string {
  const tenant = process.env.EXPO_PUBLIC_TENANT?.trim() || process.env.TENANT?.trim();
  if (!tenant) {
    throw new Error(
      'EXPO_PUBLIC_TENANT or TENANT is required; refusing to default to coffee-story',
    );
  }
  return tenant;
}

async function main(): Promise<void> {
  if (process.argv.includes('--skip')) {
    console.log('Skipping org web static export (--skip).');
    return;
  }
  const tenant = requiredTenant();
  for (const surface of SURFACES) await exportSurface(surface, tenant);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
