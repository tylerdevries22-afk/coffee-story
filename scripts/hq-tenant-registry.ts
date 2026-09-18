/**
 * The HQ console's tenant registry, generated from the tenants/ directory.
 *
 * The console used to name its tenants by hand -- ten JSON imports and a
 * five-entry list in apps/hq/lib/tenants.ts -- and nothing scanned the tree, so
 * a tenant folder nobody remembered to add there never reached the
 * organization switcher at all. The guest apps had the same problem and solved
 * it with a generated barrel (onboard-tenant-barrel.ts); this is that pattern
 * pointed at the console. Next, like Metro, resolves imports at build time, so
 * every path is a literal, and the list is derived from the tree rather than
 * remembered.
 *
 * Only the data is generated. The switcher's order and the launch tenant's
 * fixtures are decisions, and stay hand-written in apps/hq/lib/tenants.ts.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPlatformSlug } from '@platform/schema';

import { pascal } from './onboard-tenant-barrel.js';

/** Where the registry is written, relative to the repository root. */
export const HQ_TENANT_REGISTRY = 'apps/hq/lib/tenants.generated.ts';

/** `../../../tenants`: how the generated module reaches a tenant folder. */
const TENANTS_FROM_REGISTRY = posix.relative(posix.dirname(HQ_TENANT_REGISTRY), 'tenants');

const REQUIRED_FILES = ['brand.json', 'modules.json'] as const;

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

/**
 * A folder name lands in generated TypeScript twice, as an import path and as
 * a string literal, so it is checked rather than trusted. Kebab-case cannot
 * close a quote or climb out of a directory.
 */
function assertTenantSlug(slug: string): void {
  if (!isPlatformSlug(slug)) {
    throw new Error(
      `tenants/${slug} is not a kebab-case tenant slug. Rename it, or prefix it with "_" if it is `
      + 'scaffolding; the HQ registry names each tenant folder literally.',
    );
  }
}

/**
 * Every tenant folder the console should list, sorted.
 *
 * Scaffolding is skipped: `_template`, and any other `_`-prefixed folder,
 * which onboard.ts already treats as validation-only with no identity to seed.
 * So are dot directories, which are tooling debris rather than tenants. Any
 * other folder must be a complete tenant, and one that is not fails loudly --
 * skipping it quietly would hide it from the console, which is the bug this
 * generator exists to remove.
 */
export function hqTenantSlugs(root: string): readonly string[] {
  const directory = join(root, 'tenants');
  const slugs = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[_.]/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const slug of slugs) {
    assertTenantSlug(slug);
    for (const file of REQUIRED_FILES) {
      if (!isFile(join(directory, slug, file))) {
        throw new Error(
          `tenants/${slug} has no ${file}. Every tenant folder needs brand.json and modules.json `
          + 'to appear in the HQ console; copy their shape from tenants/_template/.',
        );
      }
    }
  }
  return slugs;
}

/**
 * The registry module for a set of slugs.
 *
 * Pure, and sorted here rather than trusting the caller, so the bytes depend
 * only on which tenants exist and never on the order a directory listing
 * happened to return them in.
 */
export function renderHqTenantRegistry(slugs: readonly string[]): string {
  const tenants = [...slugs].sort().map((slug) => {
    assertTenantSlug(slug);
    return { slug, identifier: pascal(slug) };
  });
  // `pascal` is not injective where a hyphen meets a digit (`a-1` and `a1` are
  // both `A1`), and a repeated slug collides with itself. Either would emit a
  // duplicate import that fails to compile a long way from its cause.
  const seen = new Map<string, string>();
  for (const { slug, identifier } of tenants) {
    const earlier = seen.get(identifier);
    if (earlier !== undefined) {
      throw new Error(`tenants/${earlier} and tenants/${slug} both generate the identifier ${identifier}. Rename one.`);
    }
    seen.set(identifier, slug);
  }
  const imports = tenants.flatMap(({ slug, identifier }) => [
    `import brand${identifier} from '${TENANTS_FROM_REGISTRY}/${slug}/brand.json';`,
    `import modules${identifier} from '${TENANTS_FROM_REGISTRY}/${slug}/modules.json';`,
  ]);
  const entries = tenants.map(({ slug, identifier }) =>
    `  { slug: '${slug}', brand: brand${identifier}, modules: modules${identifier} },`);
  return `/**
 * Every tenant folder under /tenants, as the HQ console's registry reads them.
 *
 * GENERATED from tenants/ by \`pnpm hq:tenants\`, which \`pnpm onboard\` also
 * runs. Do not edit: add or remove a tenant folder and regenerate.
 *
 * One literal import per file, because Next resolves imports at build time and
 * cannot follow a computed path. Sorted by slug; the order the switcher shows,
 * and anything else that is a decision rather than a scan, is ./tenants.ts's.
 */
${imports.join('\n')}${imports.length > 0 ? '\n' : ''}
/**
 * The fields ./tenants.ts reads by name. Typed here so a tenant whose files
 * lack them fails the console's typecheck instead of rendering a blank org.
 */
export type GeneratedTenant = {
  readonly slug: string;
  readonly brand: { readonly identity: { readonly name: string } };
  readonly modules: {
    readonly modules: readonly { readonly key: string; readonly enabled?: boolean }[];
  };
};

export const GENERATED_TENANTS: readonly GeneratedTenant[] = [
${entries.join('\n')}${entries.length > 0 ? '\n' : ''}];
`;
}

export type HqRegistryWrite = {
  readonly slugs: readonly string[];
  /** False when the file already held these bytes and was left untouched. */
  readonly changed: boolean;
};

/**
 * Writes the registry for a checkout, leaving the file alone when it is
 * already current.
 *
 * Not rewriting identical bytes is load-bearing, not tidiness: onboarding runs
 * this against the working tree -- the onboarding CLI test included -- while
 * the drift test reads the same file, and a truncate-then-write is a window in
 * which that read sees an empty module.
 */
export function writeHqTenantRegistry(root: string): HqRegistryWrite {
  const slugs = hqTenantSlugs(root);
  const path = join(root, HQ_TENANT_REGISTRY);
  const contents = renderHqTenantRegistry(slugs);
  if (isFile(path) && readFileSync(path, 'utf8') === contents) return { slugs, changed: false };
  writeFileSync(path, contents);
  return { slugs, changed: true };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { slugs, changed } = writeHqTenantRegistry(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    console.log(`${HQ_TENANT_REGISTRY}: ${changed ? 'regenerated' : 'already current'} (${slugs.join(', ')})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
