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
  // The operator shell is staff-facing and tablet-first; its shared screen
  // wrapper constrains wide admin surfaces while the customer shell remains
  // edge-to-edge for guest ordering.
  'components/collapsing-screen.tsx',
  'components/icon-map.ts',
  // Each install prompt is dismissed independently; sharing this key would
  // let installing one persona suppress the other app's prompt.
  'components/install-prompt.web.tsx',
  'data/business.ts',
  // The customer validates its generated tenant menu; the neutral operator
  // validates the platform demo fallback it can use before staff sign-in.
  'data/catalog.test.ts',
  'data/catalog.ts',
  'data/demo.ts',
  'features/drops.test.ts',
  'features/drops.ts',
  // The setup defaults assert the same rule-7 split as the implementations:
  // a customer binary names its bundled tenant, while the pre-login operator
  // must stay neutral until a staff session identifies the brand.
  'features/setup/setup.test.ts',
  'features/setup/setup.ts',
  // The live planes are persona-different by design: the customer bundle is
  // a guest's world through the platform API, the operator's is staff claims
  // and direct-RLS board writes; their live-config needs differ the same way.
  'lib/demo-sync.ts',
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
  // The same rule-7 split as state/business.ts, one layer down: demo data needs
  // a tax list, and where that list comes from is exactly what differs. The
  // customer binary is one brand, so it reads the tenant it bundles; the
  // operator is tenanted by login and has no bundled tenant, so its demo mode
  // reads the demo fallback. Two lines, and they cannot be the same line.
  'state/demo-state.ts',
  'state/demo-state.test.ts',
  // Demo persistence must be namespaced per installed app for the same reason
  // as the install prompt: one persona cannot overwrite the other's mode.
  'state/demo-storage-keys.ts',
  // The operator's staff bar lost calendar/quick-actions/clients/checkout with
  // the booking workspace, so its route vocabulary is genuinely smaller than the
  // customer copy's. Promoting the module to packages/* retires all three.
  'state/navigation-state.property.test.ts',
  'state/navigation-state.test.ts',
  'state/navigation-state.ts',
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

  const paired = new Set(shared);
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
    const converged = DIVERGENT_BY_DESIGN.filter((path) => paired.has(path) && !divergent.includes(path));
    assert.deepEqual(
      converged,
      [],
      `These files are identical again — remove them from DIVERGENT_BY_DESIGN so the guard protects them:\n  ${converged.join('\n  ')}`,
    );
  });

  // Split from the check above because the two failures need different
  // answers. A converged pair means "delete the entry, the guard now protects
  // you"; an unpaired entry means one copy is gone -- promoted or deleted --
  // and there is nothing left to guard. Reported together, the message sent
  // you to diff two files when one of them no longer existed.
  it('the divergent-by-design list names only live pairs', () => {
    const unpaired = DIVERGENT_BY_DESIGN.filter((path) => !paired.has(path));
    assert.deepEqual(
      unpaired,
      [],
      `These entries no longer exist in both apps — one copy was promoted or deleted, so drop them from DIVERGENT_BY_DESIGN:\n  ${unpaired.join('\n  ')}`,
    );
  });

  it('still guards a meaningful shared surface (sanity check the walker)', () => {
    assert.ok(shared.length > 50, `expected many shared paths, found ${shared.length}`);
  });
});
