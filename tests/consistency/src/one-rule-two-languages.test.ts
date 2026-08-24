import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// Deep import: this package is `"type": "module"` and the workspace packages
// are not, so Node's CJS named-export detection cannot see through an
// `export *` barrel.
import { isOwnedChannel } from '@platform/domain/src/order-channel.ts';

/**
 * Rules that exist in two languages.
 *
 * A Postgres view and a bundled TypeScript app cannot share a function, so a
 * handful of rules are necessarily written twice. Every one of those is a
 * place where the two can drift silently -- and one already had: 0008's
 * `in_app_share` filtered on `('app','web')` while `isOwnedChannel` had been
 * corrected to include the kiosk, so the database and the domain disagreed
 * about the headline number on the owner's dashboard for as long as nobody
 * compared them. This is the comparison.
 *
 * It lives here rather than in `packages/schema` because schema is what domain
 * is built on: a test needing both belongs in the package that already depends
 * on both, not in one that would have to take a circular dependency to reach
 * the other.
 */
const ROOT = join(process.cwd(), '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

function orderedSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
    .join('\n');
}

describe('one rule, two languages', () => {
  it('defines the owned channel the same way in SQL as in TypeScript', () => {
    const fn = /create or replace function app\.is_owned_channel[\s\S]*?\$\$;/.exec(orderedSql());
    assert.ok(fn, 'app.is_owned_channel is not defined');
    const inSql = [...(fn[0].match(/'(app|web|kiosk|pos)'/g) ?? [])]
      .map((quoted) => quoted.replace(/'/g, ''))
      .sort();

    // Read the TypeScript by evaluating it rather than parsing it: what
    // matters is what the function ANSWERS, not how it is written.
    const channels = ['app', 'web', 'kiosk', 'pos'] as const;
    const inTs = channels.filter((channel) => isOwnedChannel(channel)).sort();

    assert.deepEqual(inSql, [...inTs],
      'app.is_owned_channel and isOwnedChannel disagree about which channels '
      + "are the shop's own. in_app_share is computed from the SQL one and "
      + 'read by HQ and the owner\'s weekly email.');
  });

  it('has the metric view call the function rather than inline a literal', () => {
    // The drift only became possible because the rule was a literal inside a
    // view. Calling the function is what makes the test above sufficient.
    const views = [...orderedSql().matchAll(
      /create or replace view public\.location_daily_metrics[\s\S]*?;/g)];
    const inForce = views[views.length - 1]?.[0] ?? '';
    assert.match(inForce, /app\.is_owned_channel\(o\.channel\)/);
    assert.ok(!/channel in \('app', 'web'\)/.test(inForce),
      'the old literal is back; the function exists so it does not have to be');
  });
});
