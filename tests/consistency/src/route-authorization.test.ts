import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Every route reachable from outside is either authenticated or listed here
 * with the reason it is not.
 *
 * This is an inventory test, and the shape matters: an allow-list that must be
 * edited to add an unauthenticated route turns "I forgot the auth call" into a
 * failing test and a deliberate decision into a one-line diff with a reason
 * attached. A test that merely counted authenticated routes would pass forever
 * while the denominator grew.
 *
 * It runs with no database, which is the point. `hosted-integration` is gated
 * to non-pull-request events so branch code never holds the project-creation
 * token, so nothing on a pull request executes a route, a policy, or a
 * migration. Static inventory is the only authorization check a pull request
 * can actually run.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const HQ_API = join(ROOT, 'apps/hq/app/api');

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...routeFiles(full));
    else if (entry === 'route.ts' || entry === 'route.tsx') found.push(full);
  }
  return found.sort();
}

const apiRoutes = routeFiles(HQ_API).map((file) => ({
  id: relative(HQ_API, file).replace(/\/route\.tsx?$/, ''),
  source: readFileSync(file, 'utf8'),
}));

/**
 * The helpers that establish who is calling.
 *
 * Three kinds, all of which identify a caller. `authenticate` and
 * `authenticateAny` verify a Supabase access token and return claims;
 * `matchesSecret` is the shared-secret comparison the cron endpoints use;
 * `verifyDeviceToken` checks a device's twelve-hour token. `redeemPairingCode`
 * and `exchangeDeviceRefreshSecret` are the bootstrap pair -- a screen with no
 * token yet presents a single-use pairing code or its long-lived refresh
 * secret, and the credential in the body *is* the authentication. Both answer
 * every failure identically so a caller cannot learn whether a candidate is
 * unknown, expired, redeemed or revoked, and both are rate-limited, because
 * online brute force is the residual risk once the oracle is closed.
 *
 * `operationsRequestContext` is the fourth kind: a shared helper that calls
 * `authenticate`, checks the role floor, throttles, and resolves the
 * workforce-operations installation before handing a route its database
 * handle. The twenty-odd operations routes authenticate through it rather than
 * directly, which is the pattern to prefer -- one place to change when the
 * capability moves, as it just did.
 *
 * A route that calls none of these has not identified its caller.
 */
const AUTHENTICATES = new RegExp('\\b(' + [
  'authenticateAny', 'authenticate', 'matchesSecret', 'verifyDeviceToken',
  'redeemPairingCode', 'exchangeDeviceRefreshSecret', 'operationsRequestContext', 'authorizeConnectorOAuth',
].join('|') + ')\\b');

/**
 * The shared helper every operations route funnels through, and the three
 * things it must keep doing. If one is dropped, every one of those routes
 * loses it at once -- which is the risk that comes with the convenience.
 */
const OPERATIONS_CONTEXT_GUARDS: readonly (readonly [string, RegExp])[] = [
  ['authenticates the caller', /\bawait authenticate\(/],
  ['enforces a role floor', /roleAtLeast\(/],
  ['throttles', /operationsRateLimited\(/],
  ['resolves the workforce-operations installation', /module_installations[\s\S]{0,200}workforce-operations/],
];

/** The bootstrap credential routes must stay throttled; the credential is guessable in principle. */
const THROTTLED_BOOTSTRAP = ['devices/pair', 'devices/exchange'] as const;

/**
 * Routes that answer without identifying the caller, and why each is allowed to.
 *
 * Every entry is a claim about a *different* guard, not an exemption from
 * having one. Adding a route here without one of those guards is the bug this
 * test exists to catch.
 */
const UNAUTHENTICATED: Readonly<Record<string, { reason: string; guard: RegExp }>> = {
  'demo-media/menu/[slug]': {
    reason: 'immutable bundled preview media, loopback hostnames only',
    guard: /demoMediaAvailable/,
  },
  'demo-media/training/[track]': {
    reason: 'immutable bundled preview media, loopback hostnames only',
    guard: /demoMediaAvailable/,
  },
  'demo-sync/board': {
    reason: 'local preview projection, loopback plus an explicit runtime flag',
    guard: /demoSyncAvailable/,
  },
  'demo-sync/orders': {
    reason: 'local preview order writes, loopback plus an explicit runtime flag',
    guard: /demoSyncAvailable/,
  },
  'demo-sync/orders/[orderId]': {
    reason: 'local preview order reads, loopback plus an explicit runtime flag',
    guard: /demoSyncAvailable/,
  },
  'square/connect': {
    reason: 'mints OAuth state for the signed-in console user',
    guard: /auth\.getSession\(\)/,
  },
  'square/callback': {
    reason: 'verifies the signed OAuth state, then re-checks the console cookie session',
    guard: /decodeOAuthState/,
  },
  'webhooks/square': {
    reason: 'verified against the Square subscription signature key, not a session',
    guard: /verifySquareSignature/,
  },
};

describe('HQ API routes identify their caller', () => {
  it('finds the route tree, so the suite cannot pass by enumerating nothing', () => {
    assert.ok(apiRoutes.length > 40, `found only ${apiRoutes.length} API routes`);
  });

  it('authenticates every route that is not explicitly exempted', () => {
    const unguarded = apiRoutes
      .filter((route) => !AUTHENTICATES.test(route.source))
      .map((route) => route.id)
      .filter((id) => !(id in UNAUTHENTICATED));
    assert.deepEqual(unguarded, [],
      'these routes identify no caller. Add an authenticate() call, or add an '
      + 'entry to UNAUTHENTICATED naming the guard that stands in for one.');
  });

  it('holds every exempted route to the guard its entry claims', () => {
    for (const [id, entry] of Object.entries(UNAUTHENTICATED)) {
      const route = apiRoutes.find((candidate) => candidate.id === id);
      assert.ok(route, `${id} is exempted but no longer exists; drop the entry`);
      assert.match(route.source, entry.guard,
        `${id} is exempted because "${entry.reason}", but that guard is gone`);
    }
  });

  it('keeps the bootstrap credential routes rate-limited', () => {
    for (const id of THROTTLED_BOOTSTRAP) {
      const route = apiRoutes.find((candidate) => candidate.id === id);
      assert.ok(route, `${id} no longer exists`);
      assert.match(route.source, /\brateLimited\b/,
        `${id} authenticates by a credential in the body, so throttling is the `
        + 'only thing between it and an offline-speed guessing attack');
    }
  });

  it('holds the shared operations context to what its callers rely on', () => {
    const source = readFileSync(join(ROOT, 'apps/hq/lib/operations-api.ts'), 'utf8');
    for (const [what, pattern] of OPERATIONS_CONTEXT_GUARDS) {
      assert.match(source, pattern,
        `operationsRequestContext no longer ${what}, and every operations route `
        + 'authenticates through it');
    }
  });

  it('keeps the exemption list from growing silently', () => {
    // Eight, each argued above. A ninth is a decision someone should have to
    // make on purpose, not a number that drifts.
    assert.equal(Object.keys(UNAUTHENTICATED).length, 8);
  });
});

/**
 * Capability reads answer from the installation, never from the retired
 * feature columns.
 *
 * 20260903220000 made an active `workforce-operations` installation the thing
 * that grants operations, and every RLS policy now resolves it through
 * `app.brand_operations_enabled`. Two console read paths kept querying
 * `brands.operations` afterwards, so a brand that installed the module without
 * anyone setting the legacy column got the nav link and an empty page. The
 * column is dropped in a later phase, at which point a straggler stops being
 * an inconsistency and becomes a 404 for everyone.
 */
describe('capability reads use module installations', () => {
  const HQ_LIB = join(ROOT, 'apps/hq/lib');
  const sources = readdirSync(HQ_LIB)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, source: readFileSync(join(HQ_LIB, name), 'utf8') }));

  it('reads the tree it means to', () => {
    assert.ok(sources.length > 20, `found only ${sources.length} lib modules`);
  });

  for (const column of ['operations', 'drops', 'catering', 'delivery', 'stored_value', 'referrals'] as const) {
    it(`never selects brands.${column} as a capability`, () => {
      const offenders = sources
        .filter((entry) => new RegExp(`from\\('brands'\\)[\\s\\S]{0,80}select\\((['"\`])[^'"\`]*\\b${column}\\b`).test(entry.source))
        .map((entry) => entry.name);
      assert.deepEqual(offenders, [],
        `resolve this through module_installations (activeModuleKeys, or a `
        + `module_key query on a service client) rather than the legacy column`);
    });
  }
});
