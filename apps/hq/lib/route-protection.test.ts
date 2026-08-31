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
];

test('the public allowlist is exactly the reviewed set', () => {
  const body = middleware.match(/const PUBLIC_PREFIXES = \[([^\]]*)\]/)?.[1];
  if (typeof body !== 'string') throw new Error('PUBLIC_PREFIXES must exist in middleware.ts');
  const declared = body.split(',').map((entry) => entry.trim()).filter(Boolean);
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
