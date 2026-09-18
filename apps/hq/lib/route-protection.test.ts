/**
 * A static gate on the console's authenticated-route protection. The middleware
 * is the console's only page-level guard: on a configured deployment every path
 * that is not explicitly public redirects to /login. If someone widens the
 * public allowlist, drops the catch-all redirect, or narrows the matcher so
 * real routes stop running through it, that is a silent authentication
 * regression -- this test fails the build instead of shipping it.
 *
 * The demo bypass (no Supabase env -> pass through on the demo session) is
 * intentional and is asserted here too, so it stays a deliberate, reviewed
 * escape hatch rather than drifting into the auth path by accident.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const middleware = readFileSync(
  fileURLToPath(new URL('../middleware.ts', import.meta.url)),
  'utf8',
);

// The complete set of prefixes allowed to render without a session. Adding one
// is a security decision, so it has to be made here, in the test, on purpose.
const ALLOWED_PUBLIC_PREFIXES = [
  "'/login'",
  "'/auth/callback'",
  "'/api/'",
  "'/status/'",
  // Model B: Expo static shells on the HQ origin. Shells are public; APIs stay
  // bearer-auth (guest JWT / device JWT / staff). Operator is a public SPA shell
  // only — credentials never ride cookies on this path.
  "'/customer'",
  "'/kiosk'",
  "'/operator'",
  // The unattended screen in a venue's entrance. Reviewed and allowed because
  // there is no account to gate it on: a lobby device has no keyboard, no
  // session and nobody to attribute an action to, so requiring one would leave
  // it permanently redirected to /login.
  //
  // What it exposes is a property's own published identity -- name, street
  // address, front-desk hours, website -- read from the committed tenant
  // folder, which is the same information the hotel puts on its own site and
  // its public listing. It runs no query, holds no per-guest state, and has no
  // control that writes anything. Slug enumeration is the one real cost, and
  // it is the cost the three shells above already carry.
  "'/lobby'",
  // A prospect's demo link. Reviewed and allowed because the person it is for
  // has no account by design: the link in their inbox is the credential. Every
  // path under it checks a 256-bit bearer token -- in the URL once, then in
  // an httpOnly cookie that holds the same token -- against a stored SHA-256
  // hash, before it reads anything. The trailing slash keeps it from matching
  // any console path that merely starts with "d".
  //
  // What it exposes is one business's demo, built from that business's own
  // public listing and website, until it expires. It runs no query outside the
  // demo tables, holds no staff or tenant data, never creates a session and
  // cannot reach the console. The only write is "remove my business", which is
  // exactly what the recipient must be able to do without signing in. It is
  // rate limited, noindex, no-referrer and no-store.
  "'/d/'",
  // The same prospect's demo, as the working customer/kiosk app rather than
  // the landing page. Reviewed and allowed for the same reason /d/ is: the
  // recipient has no account. The static shell under /demo/ is public but
  // holds no business's data -- one neutral runtime bundle serves every demo
  // -- and the only business data it ever shows comes from /d/pack.json,
  // which checks the httpOnly cookie /d/ set. It serves no session or
  // credential of its own, never staff or tenant data, and it is noindex,
  // no-referrer and no-store.
  // The trailing slash keeps it from matching /demos, the staff console's
  // demo-factory dashboard.
  "'/demo/'",
];

test('the public allowlist is exactly the reviewed set', () => {
  const body = middleware.match(/const PUBLIC_PREFIXES = \[([\s\S]*?)\]/)?.[1];
  if (typeof body !== 'string') throw new Error('PUBLIC_PREFIXES must exist in middleware.ts');
  const declared = body
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .join(' ')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("'"));
  assert.deepEqual(
    declared.sort(),
    [...ALLOWED_PUBLIC_PREFIXES].sort(),
    'A new public prefix bypasses auth -- update ALLOWED_PUBLIC_PREFIXES here only after review.',
  );
});

test('unauthenticated non-public paths redirect to /login', () => {
  assert.match(
    middleware,
    /if \(!data\.user && !isPublic\)/,
    'The catch-all redirect for signed-out users must remain.',
  );
  assert.match(middleware, /login\.pathname = '\/login'/);
});

test('the demo bypass stays gated on missing Supabase env', () => {
  // Pass-through only when there is no configured auth backend, never on a
  // configured deployment.
  assert.match(
    middleware,
    /if \(!url \|\| !anonKey\) return NextResponse\.next/,
    'The unauthenticated pass-through must be gated on missing env.',
  );
});

test('the matcher still runs middleware on application routes', () => {
  // The matcher may exclude static assets, but must not exclude page routes;
  // a bare data path like /drops has to pass through the guard.
  assert.match(middleware, /matcher: \[/);
  assert.doesNotMatch(
    middleware,
    /matcher: \['\/api/,
    'The matcher must not be narrowed to a subset that skips page routes.',
  );
});
