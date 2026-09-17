/**
 * Place resolver: `pnpm resolve-places --tenant <slug>` (add `--check` for CI).
 *
 * Turns each branch's `placeQuery` -- the property named the way a person would
 * name it -- into a verified `googlePlaceId`, and writes it back into the
 * tenant folder.
 *
 * Why this exists rather than an operator pasting ids. A Google Place id is an
 * opaque string with no readable relationship to the place it names, so a
 * mistyped or mis-copied one is invisible: the tenant validates, onboarding
 * succeeds, and the property's lobby screen shows the opening hours of whatever
 * that id actually points at. Resolving from text and asserting the result is
 * lodging turns that silent failure into a loud one.
 *
 * It is also what makes "any hotel chain, any location" true rather than
 * aspirational. Adding the chain's next branch is one entry in `brand.json`
 * plus one run of this; no edit to this repo's source, and no id typed by hand.
 *
 * Idempotent: a branch that already carries an id is left alone unless
 * `--force` is passed, so re-running costs nothing and re-resolves nothing.
 *
 * The key comes from `GOOGLE_PLACES_API_KEY` in the environment. It is never
 * read from a tenant folder and never written to one: every `EXPO_PUBLIC_*`
 * value ships readable inside a guest bundle, and a Places key must not.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { findLodging } from '@platform/engine';

import {
  applyResolvedPlaces,
  resolveLocations,
  tenantBrandPath,
  type PlaceLocation,
  type PlaceOutcome,
} from './resolve-tenant-places-lib';

type Brand = { identity?: { name?: string }; locations?: PlaceLocation[] };

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function option(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function describe(outcome: PlaceOutcome): string {
  switch (outcome.kind) {
    case 'resolved':
      return `  resolved  ${outcome.name} -> ${outcome.place.placeId} (${outcome.place.name})`;
    case 'kept':
      return `  kept      ${outcome.name} -> ${outcome.placeId}`;
    case 'skipped':
      return `  skipped   ${outcome.name}: ${outcome.why}`;
    default:
      return `  FAILED    ${outcome.name}: ${outcome.why}`;
  }
}

async function main(): Promise<number> {
  const slug = option('tenant');
  if (!slug) {
    console.error('Usage: pnpm resolve-places --tenant <slug> [--check] [--force]');
    return 2;
  }
  const check = flag('check');
  const force = flag('force');
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const path = tenantBrandPath(process.cwd(), slug);
  const brand = JSON.parse(readFileSync(path, 'utf8')) as Brand;
  const locations = brand.locations ?? [];
  if (locations.length === 0) {
    console.log(`${slug}: no locations to resolve.`);
    return 0;
  }

  console.log(`${slug}: ${locations.length} location(s)`);

  if (check) {
    // CI asks a different question -- is every branch already linked? -- and
    // answers it from the file alone. Resolving first would spend a metered
    // call per branch on every CI run to learn something already on disk.
    const unresolved = locations.filter((location) => !location.googlePlaceId);
    for (const location of locations) {
      console.log(location.googlePlaceId
        ? `  linked    ${location.name ?? 'unnamed branch'} -> ${location.googlePlaceId}`
        : `  UNLINKED  ${location.name ?? 'unnamed branch'}`);
    }
    if (unresolved.length > 0) {
      console.error(`\n${unresolved.length} branch(es) carry no googlePlaceId. Run without --check to resolve.`);
      return 1;
    }
    console.log('\nEvery branch is linked to a Place.');
    return 0;
  }

  const outcomes = await resolveLocations(
    locations,
    (query) => findLodging(query, { apiKey }),
    force,
  );
  for (const outcome of outcomes) console.log(describe(outcome));

  const resolved = outcomes.filter((outcome) => outcome.kind === 'resolved');
  const failed = outcomes.filter((outcome) => outcome.kind === 'failed');

  if (resolved.length > 0) {
    const applied = applyResolvedPlaces(locations, outcomes);
    writeFileSync(path, `${JSON.stringify(brand, null, 2)}\n`);
    console.log(`\nWrote ${applied} Place id(s) into tenants/${slug}/brand.json`);
  }

  if (failed.length > 0) {
    const unconfigured = failed.some((outcome) => outcome.kind === 'failed' && outcome.why === 'unconfigured');
    if (unconfigured) console.error('\nSet GOOGLE_PLACES_API_KEY to resolve listings.');
    return 1;
  }
  return 0;
}

main().then((code) => { process.exitCode = code; }, (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
