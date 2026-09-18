/**
 * Model B guest surfaces: export Expo web apps with path prefixes into HQ public/.
 * HQ remains the org web host; /customer /kiosk /operator are co-located static apps.
 * Display stays on its own Next deployment until Vercel Services can host two Next apps.
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const HQ_PUBLIC = join(ROOT, 'apps', 'hq', 'public');

/**
 * Every applied tenant, exported a second time under /t/<slug>/<surface>.
 *
 * Model B gives one HQ origin per organization and serves that org's guest
 * apps at /customer, /kiosk and /operator. The staff wall needs more: it
 * previews whichever organization the console has selected, and every hosted
 * surface answers `frame-ancestors 'self'`, so a frame pointed at another
 * org's deployment is refused by the browser and paints blank. Same-origin
 * per-tenant paths are the only shape that can render more than one tenant.
 */
function appliedTenants(): string[] {
  const applied = JSON.parse(
    readFileSync(join(ROOT, 'apps', 'customer', 'src', 'tenants', 'applied.json'), 'utf8'),
  ) as { slugs?: unknown };
  const slugs = Array.isArray(applied.slugs) ? applied.slugs : [];
  return slugs.filter((slug): slug is string => typeof slug === 'string' && slug.length > 0);
}

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

/**
 * The environment one export runs in: every tenant signal names that export's
 * tenant.
 *
 * The deployment's own TENANT (coffee-story, on HQ) is inherited otherwise, and
 * the guest apps' Expo config refuses a TENANT that disagrees with
 * EXPO_PUBLIC_TENANT. That broke the first production-shaped --wall build on
 * the first copy for any other tenant.
 */
export function exportEnvironment(
  base: NodeJS.ProcessEnv, tenant: string, baseUrl: string,
): NodeJS.ProcessEnv {
  return { ...base, EXPO_PUBLIC_TENANT: tenant, TENANT: tenant, EXPO_BASE_URL: baseUrl };
}

async function runExport(surface: Surface, env: NodeJS.ProcessEnv, target: string): Promise<void> {
  const appRoot = join(ROOT, 'apps', surface.app);
  const outDir = join(appRoot, 'dist-web-org');
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  await run(
    'pnpm',
    ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', 'dist-web-org'],
    appRoot,
    env,
  );
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(outDir, target, { recursive: true });
  console.log(`Published ${surface.app} → ${target.replace(ROOT, '')}`);
}

async function exportSurface(surface: Surface, tenant: string, target: string): Promise<void> {
  const restore = surface.app === 'operator' ? withOperatorBaseUrl(surface.baseUrl) : () => undefined;
  try {
    await runExport(surface, exportEnvironment(process.env, tenant, surface.baseUrl), target);
  } finally {
    restore();
  }
}

/**
 * The demo runtime export needs no tenant at all -- one export serves every
 * business, chosen at request time by /d/pack.json rather than at build
 * time. HQ's own deployment carries TENANT=coffee-story in its own process
 * env (see requiredTenant below), and #216 already found that a spawned
 * export inherits whatever the parent carries unless the child's own env
 * explicitly overrides it -- exportEnvironment does that by naming a tenant,
 * so this scrubs both tenant vars instead, rather than just adding the demo
 * flag on top of a copy that still carries coffee-story along for the ride.
 */
export function demoExportEnvironment(base: NodeJS.ProcessEnv, baseUrl: string): NodeJS.ProcessEnv {
  return {
    ...base,
    EXPO_PUBLIC_TENANT: undefined,
    TENANT: undefined,
    EXPO_PUBLIC_DEMO_RUNTIME: '1',
    EXPO_BASE_URL: baseUrl,
  };
}

const DEMO_SURFACES: readonly Surface[] = [
  { app: 'customer', baseUrl: '/demo/customer' },
  { app: 'kiosk', baseUrl: '/demo/kiosk' },
];

/** One export of each guest app, serving every prospect's demo from this one deployment. */
async function exportDemoSurfaces(): Promise<void> {
  for (const surface of DEMO_SURFACES) {
    await runExport(surface, demoExportEnvironment(process.env, surface.baseUrl), join(HQ_PUBLIC, 'demo', surface.app));
  }
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

export type PlannedExport = { readonly surface: Surface; readonly tenant: string; readonly target: string };

/**
 * Every export one invocation writes, in order.
 *
 * --wall adds the per-tenant copies the staff wall frames, and it is additive:
 * the unprefixed Model B paths this deployment serves at /customer, /kiosk and
 * /operator are still written after them. It used to return straight after
 * the wall loop, so a deployment built with --wall would have dropped the three
 * paths that org's own guests use. The tenant is resolved first so a missing
 * slug fails before nine slow exports rather than after them.
 */
export function plannedExports(
  argv: readonly string[],
  tenant: () => string,
  applied: () => readonly string[],
): PlannedExport[] {
  if (argv.includes('--skip')) return [];
  const own = tenant();
  const wall = argv.includes('--wall')
    ? applied().flatMap((slug) => SURFACES.map((surface) => ({
      surface: { app: surface.app, baseUrl: `/t/${slug}${surface.baseUrl}` },
      tenant: slug,
      target: join(HQ_PUBLIC, 't', slug, surface.app),
    })))
    : [];
  return [
    ...wall,
    ...SURFACES.map((surface) => ({ surface, tenant: own, target: join(HQ_PUBLIC, surface.app) })),
  ];
}

async function main(): Promise<void> {
  const plan = plannedExports(process.argv, requiredTenant, appliedTenants);
  if (plan.length === 0) {
    console.log('Skipping org web static export (--skip).');
    return;
  }
  for (const { surface, tenant, target } of plan) await exportSurface(surface, tenant, target);
  await exportDemoSurfaces();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
