/**
 * A kiosk may not be configured with a tender the platform cannot back.
 *
 * coffee-story's kiosk listed `stored_value` among its tenders and the module
 * behind it is installed, so an owner reading the config would expect guests
 * to pay from a balance at the kiosk. They never could: paying from a balance
 * needs a lookup by phone, and `GUEST_LOOKUP_IS_STUBBED` in
 * apps/kiosk/src/lib/identify.ts returns a zero balance for everyone. The
 * runtime hid the tender silently (`hasBalanceLookup: false` in pay.tsx), so
 * three built screens were dead and nothing said so.
 *
 * Same rule as the delivery tripwire, one layer over: a tenant config is a
 * claim about what the platform can do, and this fails the claim rather than
 * letting the runtime quietly drop it.
 *
 * Delete this file when a real balance lookup exists. The last test says so.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const TENANTS = join(ROOT, 'tenants');
const IDENTIFY = join(ROOT, 'apps', 'kiosk', 'src', 'lib', 'identify.ts');
/** Tenders that only work once a guest's balance can be looked up. */
const BALANCE_TENDERS = new Set(['stored_value', 'gift_card']);

function tenantSlugs(): string[] {
  return readdirSync(TENANTS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(TENANTS, entry.name, 'brand.json')))
    .map((entry) => entry.name)
    .sort();
}

/** Every `tenders` array anywhere in the config, wherever a surface keeps it. */
function tenderLists(value: unknown, path = '$'): { path: string; tenders: string[] }[] {
  if (Array.isArray(value)) return value.flatMap((entry, i) => tenderLists(entry, `${path}[${i}]`));
  if (typeof value !== 'object' || value === null) return [];
  const found: { path: string; tenders: string[] }[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === 'tenders' && Array.isArray(child) && child.every((t) => typeof t === 'string')) {
      found.push({ path: `${path}.${key}`, tenders: child as string[] });
    } else {
      found.push(...tenderLists(child, `${path}.${key}`));
    }
  }
  return found;
}

function balanceLookupIsStubbed(): boolean {
  return /export const GUEST_LOOKUP_IS_STUBBED\s*=\s*true/.test(readFileSync(IDENTIFY, 'utf8'));
}

describe('kiosk tender preconditions', () => {
  it('measures every tenant, so the guard cannot pass by finding nothing', () => {
    const slugs = tenantSlugs();
    assert.ok(slugs.length >= 4, `only ${slugs.length} tenants found`);
    assert.ok(slugs.includes('_template'));
    assert.ok(slugs.every((slug) => tenderLists(
      JSON.parse(readFileSync(join(TENANTS, slug, 'brand.json'), 'utf8')),
    ).length > 0), 'a tenant config declares no tenders at all');
  });

  it('refuses a balance tender until a guest balance can be looked up', () => {
    if (!balanceLookupIsStubbed()) return;
    const offenders: string[] = [];
    for (const slug of tenantSlugs()) {
      const config = JSON.parse(readFileSync(join(TENANTS, slug, 'brand.json'), 'utf8')) as unknown;
      for (const list of tenderLists(config)) {
        const bad = list.tenders.filter((t) => BALANCE_TENDERS.has(t));
        if (bad.length > 0) offenders.push(`${slug} ${list.path} lists ${bad.join(', ')}`);
      }
    }
    assert.deepEqual(offenders, [],
      'a tenant configures a kiosk tender that pays from a guest balance, but '
      + 'apps/kiosk/src/lib/identify.ts has no balance lookup (GUEST_LOOKUP_IS_STUBBED). '
      + 'The runtime hides the tender, so the config promises what the kiosk cannot do. '
      + 'Wire the lookup before listing the tender.');
  });

  /** When this fails because the stub is gone, delete the file: the tripwire has done its job. */
  it('records that the precondition is still missing, so the tripwire is not silent', () => {
    assert.equal(balanceLookupIsStubbed(), true,
      'the kiosk balance lookup is no longer stubbed -- re-read this file and decide whether it should go');
  });
});
