import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseBuildContext,
  parseWallSource,
  requestedTenant,
} from './preview-wall-config';

export type WallLaunch = Readonly<{
  name: string;
  executable: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  port: number;
  url: string;
}>;

export type WallLauncherArgs = Readonly<{
  requestedTenant?: string;
  rebuild: boolean;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringRecord(value: unknown): Record<string, string> | null {
  const candidate = record(value);
  if (!candidate || Object.values(candidate).some((item) => typeof item !== 'string')) return null;
  return candidate as Record<string, string>;
}

function launchEntry(input: unknown): Omit<WallLaunch, 'url'> {
  const value = record(input) ?? {};
  const args = value.runtimeArgs;
  const env = value.env === undefined ? {} : stringRecord(value.env);
  if (typeof value.name !== 'string' || value.name.length === 0
    || typeof value.runtimeExecutable !== 'string' || value.runtimeExecutable.length === 0
    || !Array.isArray(args) || !args.every((arg) => typeof arg === 'string') || env === null
    || !Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65_535) {
    throw new Error('Every wall launch entry needs a name, executable, string arguments, environment, and port.');
  }
  return {
    name: value.name,
    executable: value.runtimeExecutable,
    args: args as string[],
    env,
    port: Number(value.port),
  };
}

export function parseWallLauncherArgs(
  args: string[],
  environmentTenant: string | undefined,
): WallLauncherArgs {
  const supported = new Set(['--tenant', '--rebuild']);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument && supported.has(argument)) {
      if (seen.has(argument)) throw new Error(`Duplicate wall launcher option "${argument}".`);
      seen.add(argument);
      if (argument === '--tenant') index += 1;
      continue;
    }
    throw new Error(`Unsupported wall launcher option "${argument}".`);
  }
  const tenant = requestedTenant(args, environmentTenant);
  if (tenant) parseBuildContext({ tenantKey: tenant });
  return {
    requestedTenant: tenant,
    rebuild: args.includes('--rebuild'),
  };
}

export function readBuiltTenant(root: string): string | undefined {
  const path = join(root, 'apps', 'customer', 'dist-web', 'wall-build-context.json');
  if (!existsSync(path)) return undefined;
  let context: unknown;
  try {
    context = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    throw new Error('The wall build context is unreadable; run a full preview export.');
  }
  const tenant = parseBuildContext(context);
  return ['customer', 'operator', 'kiosk'].every((app) =>
    existsSync(join(root, 'apps', app, 'dist-web', 'index.html'))) ? tenant : undefined;
}

export function previewCommandArgs(
  tenant: string,
  builtTenant: string | undefined,
  rebuild: boolean,
): string[] {
  return builtTenant === tenant && !rebuild
    ? ['preview', '--wall', '--tenant', tenant]
    : ['preview', '--tenant', tenant];
}

export function wallLaunchPlan(root: string, tenant: string): WallLaunch[] {
  parseBuildContext({ tenantKey: tenant });
  const launchDocument = JSON.parse(
    readFileSync(join(root, '.claude', 'launch.json'), 'utf8'),
  ) as unknown;
  const launchRecord = record(launchDocument);
  const rawEntries = launchRecord?.configurations;
  if (!Array.isArray(rawEntries)) throw new Error('.claude/launch.json needs a configurations list.');
  const entries = rawEntries.map(launchEntry);
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  if (byName.size !== entries.length) throw new Error('Wall launch names must be unique.');
  if (new Set(entries.map(({ port }) => port)).size !== entries.length) {
    throw new Error('Wall launch ports must be unique.');
  }

  const wall = parseWallSource(JSON.parse(
    readFileSync(join(root, 'tools', 'preview-wall', 'surfaces.json'), 'utf8'),
  ) as unknown);
  return wall.surfaces.map((surface) => {
    const entry = byName.get(surface.launch);
    if (!entry) throw new Error(`Missing launch configuration "${surface.launch}".`);
    if (entry.port !== surface.port) {
      throw new Error(`${surface.name} uses :${surface.port} on the wall but :${entry.port} at launch.`);
    }
    return {
      ...entry,
      env: surface.launch === 'display' ? { ...entry.env, TENANT: tenant } : entry.env,
      url: `http://127.0.0.1:${surface.port}${surface.path}`,
    };
  });
}
