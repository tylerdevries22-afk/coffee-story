import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

type GuestApp = 'customer' | 'kiosk';
type Options = { app: GuestApp; tenant: string; output: string; root?: string };
type Brand = { identity: Record<string, unknown> };
type SourceMap = { sources?: unknown };

const RUNTIME_EXTENSIONS = new Set(['.hbc', '.html', '.js', '.json', '.webmanifest']);

function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  });
}

function json<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function identityMarkers(brand: Brand, selected: Brand): string[] {
  const selectedValues = new Set(Object.values(selected.identity).filter((value): value is string => (
    typeof value === 'string' && value.length >= 4
  )));
  return Object.values(brand.identity)
    .filter((value): value is string => typeof value === 'string' && value.length >= 4)
    .filter((value) => !selectedValues.has(value));
}

function sourcePaths(outputFiles: readonly string[]): string[] {
  const maps = outputFiles.filter((path) => path.endsWith('.map'));
  if (!maps.length) throw new Error('Tenant bundle assertion requires expo export --source-maps.');
  return maps.flatMap((path) => {
    const sources = json<SourceMap>(path).sources;
    if (!Array.isArray(sources) || sources.some((source) => typeof source !== 'string')) {
      throw new Error(`Invalid Metro source map: ${path}`);
    }
    return sources as string[];
  });
}

function runtimeBytes(outputFiles: readonly string[]): Buffer {
  const runtime = outputFiles.filter((path) => {
    if (path.endsWith('.map')) return false;
    const extension = path.slice(path.lastIndexOf('.'));
    return RUNTIME_EXTENSIONS.has(extension);
  });
  return Buffer.concat(runtime.map((path) => readFileSync(path)));
}

export function assertTenantBundle(options: Options): void {
  const root = options.root ?? process.cwd();
  const appRoot = join(root, 'apps', options.app);
  const output = resolve(options.output);
  if (!existsSync(output)) throw new Error(`Bundle output does not exist: ${output}`);
  const applied = json<{ slugs: string[] }>(join(appRoot, 'src', 'tenants', 'applied.json')).slugs;
  if (!applied.includes(options.tenant)) {
    throw new Error(`${options.tenant} is not applied to apps/${options.app}.`);
  }
  const outputFiles = filesBelow(output);
  const sources = sourcePaths(outputFiles).map((path) => path.replaceAll('\\', '/'));
  const selectedBrand = json<Brand>(join(appRoot, 'src', 'tenants', options.tenant, 'brand.json'));
  const bytes = runtimeBytes(outputFiles);
  const selectedRoots = [
    `/src/tenants/${options.tenant}/`, `/assets/tenants/${options.tenant}/`,
    `/assets/menu/${options.tenant}/`, `/assets/products/${options.tenant}/`,
  ];
  if (!sources.some((path) => selectedRoots.some((rootPath) => path.includes(rootPath)))) {
    throw new Error(`Bundle does not contain a selected source for ${options.tenant}.`);
  }

  for (const foreign of applied.filter((slug) => slug !== options.tenant)) {
    const roots = [
      `/src/tenants/${foreign}/`, `/assets/tenants/${foreign}/`,
      `/assets/menu/${foreign}/`, `/assets/products/${foreign}/`,
    ];
    const leakedSource = sources.find((path) => roots.some((rootPath) => path.includes(rootPath)));
    if (leakedSource) throw new Error(`Foreign tenant source in bundle: ${leakedSource}`);
    const leakedFile = outputFiles.find((path) => (
      `/${relative(output, path).split(sep).join('/')}/`.includes(`/${foreign}/`)
    ));
    if (leakedFile) throw new Error(`Foreign tenant public file in bundle: ${leakedFile}`);
    const foreignBrand = json<Brand>(join(appRoot, 'src', 'tenants', foreign, 'brand.json'));
    const marker = identityMarkers(foreignBrand, selectedBrand)
      .find((value) => bytes.includes(Buffer.from(value)));
    if (marker) throw new Error(`Foreign tenant identity in bundle: ${JSON.stringify(marker)}`);
  }
}

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const app = argument('app');
    if (app !== 'customer' && app !== 'kiosk') throw new Error(`Unsupported guest app: ${app}`);
    const tenant = argument('tenant');
    const output = argument('output');
    assertTenantBundle({ app, tenant, output });
    console.log(`Tenant bundle isolated: ${app}/${tenant} (${basename(output)})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Tenant bundle assertion failed.');
    process.exitCode = 1;
  }
}
