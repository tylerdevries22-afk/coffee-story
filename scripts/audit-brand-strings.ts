/**
 * The other half of rule 4, as a gate.
 *
 * "No component hard-codes a brand string" sits in the same sentence as the
 * colour rule and decays the same silent way. Nothing breaks when a shared
 * module says "Coffee Story" out loud -- it reads correctly, for the one shop
 * it was written against -- and the cost lands on the second franchisee, whose
 * staff open a training lesson telling them to follow another company's
 * procedure, or whose guests are handed a pickup card for an address in a
 * state they have never been to. Both of those were real, and both were found
 * by reading rather than by anything that would have failed a build.
 *
 * The names come from the tenant folders, not from a list in this file. A
 * platform that onboards its second tenant gets that tenant checked on the
 * same commit that creates it, with nothing here to remember to update.
 *
 * What counts is identity: what the shop is called, what it is called legally,
 * what it says under its name, and how a guest reaches it. Not its monogram or
 * gift-code prefix -- two letters match too much prose to mean anything.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type Needle = { tenant: string; field: string; value: string; pattern: RegExp };

function tracked(...patterns: string[]): string[] {
  return execFileSync('git', ['ls-files', ...patterns], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-bounded where the string starts and ends with a word character.
 *
 * "Coffee Story" must not match inside a longer word, but a hostname or a
 * bracketed phone number has punctuation at its edges, and `\b` before a `(`
 * asserts the opposite of what is meant.
 */
function boundary(value: string): RegExp {
  const lead = /^\w/.test(value) ? '\\b' : '';
  const tail = /\w$/.test(value) ? '\\b' : '';
  return new RegExp(`${lead}${escaped(value)}${tail}`, 'i');
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Every identity string one tenant folder claims. */
function needlesFor(tenantFile: string): Needle[] {
  const config = JSON.parse(readFileSync(tenantFile, 'utf8')) as Record<string, unknown>;
  const tenant = tenantFile.split('/')[1] ?? tenantFile;
  const identity = (config.identity ?? {}) as Record<string, unknown>;
  const business = (config.business ?? {}) as Record<string, unknown>;
  const location = (config.location ?? {}) as Record<string, unknown>;
  const address = (location.address ?? {}) as Record<string, unknown>;
  const host = str(business.website).replace(/^https?:\/\//, '').replace(/\/$/, '');
  const candidates: [string, string][] = [
    ['identity.name', str(identity.name)],
    ['identity.slug', str(identity.slug)],
    ['business.legalName', str(business.legalName)],
    ['business.tagline', str(business.tagline)],
    ['business.website', host],
    ['business.email', str(business.email)],
    ['business.phone', str(business.phone)],
    ['location.address.street', str(address.street)],
  ];
  return candidates
    // Three characters is the floor: shorter strings match prose, not identity.
    .filter(([, value]) => value.length > 3)
    .map(([field, value]) => ({ tenant, field, value, pattern: boundary(value) }));
}

/**
 * Files where naming a tenant is the subject, not a shortcut.
 *
 * Each entry is a claim that the file is *about* one shop -- a fixture playing
 * the part of tenant data, or the tenant's own checked-in bundle. If that stops
 * being true the entry should go, not grow.
 */
const ALLOWED = new Map<string, string>([
  ['apps/display/lib/demo-board.ts', 'a fixture brand, playing the part of tenant data on a screen with no database'],
  ['apps/hq/lib/demo-data.ts', 'the console fixtures HQ renders with no database configured'],
  ['apps/hq/lib/content-data.ts', 'as apps/hq/lib/demo-data.ts'],
  ['apps/hq/lib/factory-data.ts', 'as apps/hq/lib/demo-data.ts'],
  ['apps/hq/lib/demo-menu-media.ts', 'as apps/hq/lib/demo-data.ts'],
  ['apps/operator/src/data/business.ts', 'the documented demo fallback; the file itself says reading it in a screen is a bug'],
  ['apps/operator/src/data/catalog.ts', 'as apps/operator/src/data/business.ts'],
  ['apps/operator/src/data/demo.ts', 'as apps/operator/src/data/business.ts'],
]);

type Violation = { file: string; line: number; needle: Needle; text: string };

const needles = tracked('tenants/*/brand.json')
  // The template is the documentation for the shape, not a tenant.
  .filter((file) => !file.startsWith('tenants/_template/'))
  .flatMap(needlesFor);

const violations: Violation[] = [];
for (const file of tracked('apps/**/*.ts', 'apps/**/*.tsx', 'packages/**/*.ts', 'packages/**/*.tsx', 'apps/**/*.css', 'packages/**/*.css')) {
  // Tests name tenants on purpose: proving a resolver reads the tenant it was
  // handed requires handing it one. Excluding them checks shipped surfaces
  // rather than proofs.
  if (ALLOWED.has(file) || /\.test\.tsx?$/.test(file)) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    // Prose is not a hard-coded string. A comment explaining which shop a
    // fixture stands in for is the documentation this rule wants written.
    if (/^\s*(?:\*|\/\/)/.test(line)) return;
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    for (const needle of needles) {
      if (needle.pattern.test(code)) violations.push({ file, line: index + 1, needle, text: line.trim() });
    }
  });
}

if (violations.length === 0) {
  console.log(`rule 4: no tenant identity strings outside ${ALLOWED.size} declared fixture sites (${needles.length} checked)`);
  process.exit(0);
}

console.error(`rule 4: ${violations.length} hard-coded tenant identity string(s)\n`);
for (const { file, line, needle, text } of violations) {
  console.error(`  ${file}:${line}  (${needle.tenant} ${needle.field})\n    ${text.slice(0, 120)}`);
}
console.error(
  '\nRead the value from the tenant config the surface already holds --'
  + '\nTENANT_BRAND_CONFIG in the guest apps, the signed-in brand row in'
  + '\napps/operator and apps/hq, brand_storefront on the display. If this file'
  + '\nis a fixture standing in for tenant data, add it to ALLOWED in'
  + '\nscripts/audit-brand-strings.ts with the reason written beside it.',
);
process.exit(1);
