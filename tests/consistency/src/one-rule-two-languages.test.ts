import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

// Deep import: this package is `"type": "module"` and the workspace packages
// are not, so Node's CJS named-export detection cannot see through an
// `export *` barrel.
import { isOwnedChannel } from '@platform/domain/src/order-channel.ts';
import { REWARD_TIERS } from '@platform/domain/src/rules.ts';

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

  it('falls back to the same generic ladder the apps fall back to', () => {
    // A tenant that leaves `loyalty.tiers` empty inherits a ladder, and the
    // template promises which one. The apps read REWARD_TIERS for it; the
    // ledger cannot import them, so it writes the rungs out. Before this
    // function existed the ledger had no ladder at all -- one hardcoded rate
    // for every brand -- which is the drift this test exists to keep out.
    const fn = /create or replace function app\.loyalty_earn_rate_for[\s\S]*?\$\$;/
      .exec(orderedSql());
    assert.ok(fn, 'app.loyalty_earn_rate_for is not defined');
    const clause = /from \(values ([\s\S]*?)\) as g \(minimum, rate\)/.exec(fn[0])?.[1];
    assert.ok(clause, 'the fallback ladder is not a values list any more');
    const inSql = [...clause.matchAll(
      /\(\s*(\d+)(?:::bigint)?\s*,\s*(\d+(?:\.\d+)?)(?:::numeric)?\s*\)/g)]
      .map((rung) => ({ minimumAnnualPoints: Number(rung[1]), pointsPerDollar: Number(rung[2]) }));
    const inTs = REWARD_TIERS.map((tier) => ({
      minimumAnnualPoints: tier.minimumAnnualPoints, pointsPerDollar: tier.pointsPerDollar,
    }));
    assert.deepEqual(inSql, inTs,
      'the ledger and the apps disagree about the inherited ladder: a guest at '
      + 'a brand with no published tiers would be shown one rate and paid another');
  });

  it('reads the ladder out of the same three keys the apps parse', () => {
    // `rewardTiersFrom` is all-or-nothing on these three; a key renamed on one
    // side only would quietly drop every tenant back to the generic ladder.
    const fn = /create or replace function app\.loyalty_earn_rate_for[\s\S]*?\$\$;/
      .exec(orderedSql())?.[0] ?? '';
    for (const key of ['minimumAnnualPoints', 'pointsPerDollar', 'name']) {
      assert.ok(fn.includes(`'${key}'`), `the SQL no longer reads ${key}`);
    }
  });

  it('has the ledger call the rate function rather than inline a constant', () => {
    // The same shape as the view above: the rule drifted because it was a
    // literal -- `subtotal_cents / 10` -- inside the trigger that pays guests.
    const bodies = [...orderedSql().matchAll(
      /create or replace function app\.apply_order_event_side_effects[\s\S]*?\nend \$\$;/g)];
    const inForce = bodies[bodies.length - 1]?.[0] ?? '';
    assert.match(inForce, /app\.loyalty_earn_rate_for\(/,
      'the earn branch no longer asks for the tenant rate');
    assert.ok(!/subtotal_cents\s*\/\s*10\b(?!0)/.test(inForce),
      'the hardcoded ten points per dollar is back; every brand would earn '
      + "the first tenant's rate again");
  });

  it('keeps the three clamps a refund reversal depends on', () => {
    // packages/engine/src/loyalty.ts held a second, unreferenced copy of this
    // arithmetic -- `pointsToReverse` and `applyLedger`, tested against
    // themselves, called by nothing, and already carrying the flat ten points
    // per dollar that the trigger had just been corrected off. A copy nobody
    // runs protects nothing, so it went; these are its invariants, moved onto
    // the function that actually pays guests back.
    const bodies = [...orderedSql().matchAll(
      /create or replace function public\.loyalty_reverse_earn[\s\S]*?\nend \$\$;/g)];
    const inForce = bodies[bodies.length - 1]?.[0] ?? '';
    assert.ok(inForce, 'loyalty_reverse_earn is gone');
    // Proportional to the refunded share, and a full refund is the whole earn
    // rather than more than it.
    assert.match(inForce, /least\(1::numeric, refunded_cents::numeric \/ order_total_cents\)/,
      'a refund larger than the order would now reverse more than was earned');
    // Never more than remains unreversed: two partial refunds must not add up
    // to more than one earn.
    assert.match(inForce, /least\(proportional_points, greatest\(0, earned_points - already_reversed\)\)/,
      'repeated partial refunds could now over-reverse');
    // A reversal racing a redemption must not drive the balance below zero;
    // the event log carries the truth either way.
    assert.match(inForce, /greatest\(0, points_balance - reversal_points\)/,
      'a reversal could now leave a guest owing points');
  });
});
