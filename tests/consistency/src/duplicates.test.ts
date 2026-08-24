import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

/**
 * The two Expo apps are forks of one ancestor: 150+ source files exist at the
 * same path in both. Until each module is promoted into packages/* (the
 * CLAUDE.md rule), this guard holds the line:
 *
 *  - a file that is byte-identical in both apps must STAY identical — if you
 *    need to change one, promote it to a package instead of editing a copy;
 *  - the set of legitimately-divergent files is pinned EXACTLY — a new
 *    divergence fails loudly, and a file that converges must leave the list.
 *
 * The guard retires itself: as promotion shrinks the shared surface, the
 * pinned list shrinks with it, and when no shared files remain this test
 * deletes trivially.
 */

const ROOT = join(process.cwd(), '..', '..');
const CUSTOMER = join(ROOT, 'apps', 'customer', 'src');
const OPERATOR = join(ROOT, 'apps', 'operator', 'src');

/**
 * Files that differ by DESIGN (persona copy, navigation shape, tenant data).
 * Sorted; keep it that way. Every entry is a debt marker.
 *
 * The list shrank when the shared modules moved to @platform/domain: money,
 * tax, totals, sizes, fulfillment, rewards rules, search, notifications, the
 * information pages, intent links, portal navigation and the row types are one
 * copy now, so they cannot drift and do not need guarding. What remains here
 * is genuinely per-app -- the two personas' shells, their tenant data, and
 * their live planes.
 */
const DIVERGENT_BY_DESIGN = [
  'app/_layout.tsx',
  'app/index.tsx',
  'app/notifications.tsx',
  'components/bottom-nav.tsx',
  'components/collapsing-page-header.tsx',
  'components/icon-map.ts',
  'components/navigation/client-tabs.tsx',
  'components/navigation/native-tabs-compat.tsx',
  'components/navigation/staff-tabs.tsx',
  'components/portal-profile-card.tsx',
  'components/push-from-right.tsx',
  'components/siri/siri-assistant.tsx',
  'data/business.ts',
  'data/catalog.ts',
  'data/demo.ts',
  'features/drops.test.ts',
  'features/drops.ts',
  'features/setup/setup.ts',
  // The live planes are persona-different by design: the customer bundle is
  // a guest's world through the platform API, the operator's is staff claims
  // and direct-RLS board writes; their live-config needs differ the same way.
  'lib/live-portal.ts',
  'lib/mobile-api.ts',
  'lib/runtime-config.test.ts',
  'lib/runtime-config.ts',
  'lib/web-navigation.ts',
  'screens/auth/auth-screen.tsx',
  'screens/notifications-screen.tsx',
  'state/app-context.tsx',
  'state/auth-context.tsx',
  // Rule 7 makes this one persona-different by construction: the customer is
  // one binary per brand, so its shop is fixed at build time from the bundled
  // brand.json; the operator is one listing tenanted by login, so its shop is
  // whatever the signed-in staff member's brand row says. Same hook name, same
  // return type, two answers that cannot be the same code.
  'state/business.ts',
  'state/demo-state.test.ts',
  // The operator's staff bar lost calendar/quick-actions/clients/checkout with
  // the booking workspace, so its route vocabulary is genuinely smaller than the
  // customer copy's. Promoting the module to packages/* retires all three.
  'state/navigation-state.property.test.ts',
  'state/navigation-state.test.ts',
  'state/navigation-state.ts',
  'theme/tokens.ts',
] as const;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

describe('customer/operator duplicated-module drift guard', () => {
  const shared = sourceFiles(CUSTOMER).filter((path) => {
    try {
      statSync(join(OPERATOR, path));
      return true;
    } catch {
      return false;
    }
  });

  const divergent = shared.filter(
    (path) => readFileSync(join(CUSTOMER, path), 'utf8') !== readFileSync(join(OPERATOR, path), 'utf8'),
  );

  it('identical twins stay identical (promote to packages/* instead of editing one copy)', () => {
    const newlyDivergent = divergent.filter((path) => !DIVERGENT_BY_DESIGN.includes(path as never));
    assert.deepEqual(
      newlyDivergent,
      [],
      `These files diverged between the apps. Either revert the one-sided edit, promote the module to packages/*, or (only for a deliberate persona difference) add it to DIVERGENT_BY_DESIGN:\n  ${newlyDivergent.join('\n  ')}`,
    );
  });

  it('the divergent-by-design list carries no stale entries', () => {
    const converged = DIVERGENT_BY_DESIGN.filter((path) => !divergent.includes(path));
    assert.deepEqual(
      converged,
      [],
      `These files are identical again — remove them from DIVERGENT_BY_DESIGN so the guard protects them:\n  ${converged.join('\n  ')}`,
    );
  });

  it('still guards a meaningful shared surface (sanity check the walker)', () => {
    assert.ok(shared.length > 50, `expected many shared paths, found ${shared.length}`);
  });
});
