/**
 * PostgREST exposes exactly `public` and `storage`. Nothing more, nothing less.
 *
 * `supabase/config.toml`'s `[api] schemas` line is load-bearing in two opposite
 * directions, and nothing asserted either until now.
 *
 * Adding `app` would expose every `app.*` helper granted to `authenticated` --
 * `app.loyalty_tier_for`, `app.customer_ordered_at` and the rest -- as callable
 * RPCs with no guard, because they were written for RLS policies and the auth
 * hook, not the REST surface. The comment beside the line says so.
 *
 * The other direction already bit: five RPCs were defined only in `app` and
 * called unqualified, so PostgREST resolved them in `public`, returned
 * PGRST202, and the routes surfaced a generic 404. An owner could not revoke a
 * stolen wall tablet through the product. Those now have `public` wrappers,
 * and tests/consistency/src/rpc-names-resolve-in-public pins that every
 * `.rpc()` name has one. This pins the assumption that test rests on.
 *
 * A minimal line parser rather than a TOML dependency: the value is a flat
 * string array on one line, and a parser that understood more would invite
 * someone to move it somewhere this test cannot see.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');
const CONFIG = join(ROOT, 'supabase', 'config.toml');

function apiSchemas(): string[] | null {
  const source = readFileSync(CONFIG, 'utf8');
  const api = /\[api\]([\s\S]*?)(?:\n\[|$)/.exec(source)?.[1];
  if (!api) return null;
  const line = /^\s*schemas\s*=\s*\[([^\]]*)\]/m.exec(api)?.[1];
  if (line === undefined) return null;
  return line.split(',').map((entry) => entry.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

describe('PostgREST exposed schemas', () => {
  it('declares the list in [api] so this test is reading the real setting', () => {
    assert.notEqual(apiSchemas(), null, 'no `schemas = [...]` under [api] in supabase/config.toml');
  });

  it('exposes exactly public and storage', () => {
    assert.deepEqual(apiSchemas(), ['public', 'storage'],
      'the exposed schema list changed. Adding app exposes unguarded RLS helpers as RPCs; '
      + 'removing storage breaks every bucket read. If this is deliberate, update this test '
      + 'and rpc-names-resolve-in-public together.');
  });
});
