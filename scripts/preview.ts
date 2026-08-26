/**
 * `pnpm preview` — build the local preview and publish the five-surface wall.
 *
 * Three of the five surfaces are Expo apps, and `serve` can only show them as
 * static web exports. The trap is that `dist/` already holds the **iOS** export
 * that `pnpm verify` writes, so pointing a static server at it serves a folder
 * with no HTML in it at all — the failure looks like a broken app rather than a
 * missing build. Web therefore gets its own `dist-web/`, and this script is the
 * thing that fills it.
 *
 * It also publishes the wall (`tools/preview-wall/`) into the customer app's
 * static server rather than giving it a server of its own: the preview tooling
 * caps a worktree at five dev servers and all five are apps. `dist-web/` is
 * gitignored build output, so nothing about that lands in the repo — but it
 * does mean an export wipes the wall, which is exactly why publishing is part
 * of the same command as exporting.
 *
 *   pnpm preview           export the three Expo apps for web, then publish
 *   pnpm preview --wall    publish the wall only (seconds, not minutes)
 *
 * The ports live in `.claude/launch.json`, which is what actually starts the
 * servers, and in `tools/preview-wall/surfaces.json`, which is what the wall
 * frames. Those two drifting apart produces a wall of blank tiles and no error,
 * so this script refuses to publish when they disagree.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Surface = {
  launch: string;
  name: string;
  device: string;
  port: number;
  path: string;
  width: number;
  height: number;
  span: number;
};

type LaunchConfig = { name: string; runtimeArgs?: string[]; port?: number };

const ROOT = process.cwd();
const WALL_DIR = join(ROOT, 'tools', 'preview-wall');
const LAUNCH_FILE = join(ROOT, '.claude', 'launch.json');

/** Where the wall is published, and therefore which app must be exported last. */
const HOST_APP = 'customer';
const HOST_DIST = join(ROOT, 'apps', HOST_APP, 'dist-web');
const BROWSER_BLOCKED_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69,
  77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123,
  135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530,
  531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719,
  1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666,
  6667, 6668, 6669, 6697, 10080,
]);

const wallOnly = process.argv.slice(2).some((a) => a === '--wall' || a === '--wall-only');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * The launch entry that serves a directory tells us which apps need a web
 * export — derived rather than listed, so adding a surface to launch.json is
 * enough and there is no second list to forget.
 */
function exportTargets(configs: LaunchConfig[]): string[] {
  const apps = new Set<string>();
  for (const config of configs) {
    for (const arg of config.runtimeArgs ?? []) {
      const match = /^apps\/([^/]+)\/dist-web$/.exec(arg);
      if (match?.[1]) apps.add(match[1]);
    }
  }
  return [...apps].sort();
}

function assertPortsAgree(surfaces: Surface[], configs: LaunchConfig[]): void {
  const byName = new Map(configs.map((c) => [c.name, c]));
  const problems: string[] = [];

  for (const surface of surfaces) {
    if (BROWSER_BLOCKED_PORTS.has(surface.port)) {
      problems.push(`${surface.name}: port ${surface.port} is blocked by browsers`);
    }
    const config = byName.get(surface.launch);
    if (!config) {
      problems.push(`${surface.name}: no "${surface.launch}" entry in .claude/launch.json`);
      continue;
    }
    if (config.port !== surface.port) {
      problems.push(
        `${surface.name}: surfaces.json says :${surface.port}, launch.json says :${config.port}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `The wall and the launch configs disagree:\n  ${problems.join('\n  ')}\n` +
        'Fix tools/preview-wall/surfaces.json or .claude/launch.json so they match.',
    );
  }
}

/**
 * Each app has its own Metro FileStore cache root, so these are safe to run
 * together; they were not always, and a shared cache once had an operator
 * export serving the customer's route tree.
 */
function exportWeb(app: string, demoSyncUrl: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      'npx',
      ['expo', 'export', '--platform', 'web', '--output-dir', 'dist-web'],
      {
        cwd: join(ROOT, 'apps', app),
        stdio: 'pipe',
        env: {
          ...process.env,
          EXPO_PUBLIC_DEMO_SYNC_URL: demoSyncUrl,
          EXPO_PUBLIC_PREVIEW_WALL: '1',
        },
      },
    );

    let tail = '';
    const keep = (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);

    child.on('error', rejectPromise);
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`  ${app} exported`);
        resolvePromise();
      } else {
        rejectPromise(new Error(`${app} export failed (exit ${code}):\n${tail}`));
      }
    });
  });
}

async function main(): Promise<void> {
  const { surfaces } = readJson<{ surfaces: Surface[] }>(join(WALL_DIR, 'surfaces.json'));
  const { configurations } = readJson<{ configurations: LaunchConfig[] }>(LAUNCH_FILE);

  assertPortsAgree(surfaces, configurations);
  const hq = configurations.find((config) => config.name === 'hq');
  if (!hq?.port) throw new Error('The preview needs an hq launch entry with a fixed port.');
  const demoSyncUrl = `http://localhost:${hq.port}/api/demo-sync`;

  if (!wallOnly) {
    const apps = exportTargets(configurations);
    console.log(`Exporting for web: ${apps.join(', ')}`);
    // Metro already fans each export across worker processes. Running three
    // Metros together exhausts memory on a normal demo laptop and can make a
    // 20-second bundle take minutes, so keep the app-level queue serial.
    for (const app of apps) await exportWeb(app, demoSyncUrl);
  }

  if (!existsSync(HOST_DIST)) {
    throw new Error(
      `${HOST_DIST} does not exist — run \`pnpm preview\` without --wall to build it first.`,
    );
  }

  // Published as wall.html + wall-surfaces.json so the names cannot collide
  // with a route the customer app exports.
  copyFileSync(join(WALL_DIR, 'index.html'), join(HOST_DIST, 'wall.html'));
  copyFileSync(join(WALL_DIR, 'surfaces.json'), join(HOST_DIST, 'wall-surfaces.json'));

  const host = surfaces.find((s) => s.launch.startsWith(HOST_APP));
  const wallUrl = `http://localhost:${host?.port ?? 4170}/wall`;

  console.log('\nStart the servers from .claude/launch.json, then open the wall:\n');
  console.log(`  ${wallUrl}\n`);
  for (const surface of surfaces) {
    const url = `http://localhost:${surface.port}${surface.path}`;
    console.log(`  ${surface.name.padEnd(16)} ${surface.launch.padEnd(14)} ${url}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
