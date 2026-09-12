/**
 * Referral crediting has no backend today, but the guest app promised one:
 * an incoming-code banner said "Code X will be applied to your first order.
 * Nothing else to do," and the share card said a friend's first order gets
 * "a free drink loaded onto your rewards." Neither claim was backed --
 * `PlaceOrderRequest` (packages/api-client/src/contract.ts) carries no
 * referral field, so an order can't even record which code referred it, and
 * `complete_reward_referral_for_purchase` -- the function the app's own
 * earn-tab comment names as the credit's source
 * (apps/customer/src/screens/client/rewards/tabs/earn-tab.tsx) -- is not
 * defined anywhere in packages/schema or packages/engine. It exists only as
 * a name in that comment.
 *
 * The guest app copy has been corrected to stop promising the credit (see
 * apps/customer/src/features/referrals.ts). This is the referral sibling to
 * delivery-capability-preconditions.test.ts: a tripwire for a
 * known-incomplete capability, not a permanent rule about referrals. Delete
 * it once both preconditions are real.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(process.cwd(), '..', '..');

/** Every .ts file under a directory, tests excluded. */
function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
    }
  };
  walk(directory);
  return found;
}

/** Whether an order can carry the referral code a credit would key off. */
function orderInputCarriesReferralCode(): boolean {
  const contract = readFileSync(join(ROOT, 'packages', 'api-client', 'src', 'contract.ts'), 'utf8');
  const start = contract.indexOf('export type PlaceOrderRequest');
  const end = contract.indexOf('export type PlaceOrderResponse');
  assert.ok(start >= 0 && end > start, 'PlaceOrderRequest moved or was renamed -- update this test to find it');
  return /referral/i.test(contract.slice(start, end));
}

/** Whether the function the app promises will award the credit exists anywhere real. */
function referralCreditFunctionExists(): boolean {
  const needle = /complete_reward_referral_for_purchase/;
  return sourceFiles(join(ROOT, 'packages', 'schema', 'src')).some((file) => needle.test(readFileSync(file, 'utf8')))
    || sourceFiles(join(ROOT, 'packages', 'engine', 'src')).some((file) => needle.test(readFileSync(file, 'utf8')));
}

describe('referral capability preconditions', () => {
  it('records which preconditions are still missing, so the tripwire is not silent', () => {
    const missing = [
      orderInputCarriesReferralCode() ? null : 'PlaceOrderRequest carries no referral field',
      referralCreditFunctionExists()
        ? null
        : 'complete_reward_referral_for_purchase is not defined in packages/schema or packages/engine',
    ].filter((entry): entry is string => entry !== null);
    // Both are expected to be missing right now. When this fails because the
    // list is empty, delete this file: the capability is real and the
    // tripwire has done its job.
    assert.deepEqual(missing, [
      'PlaceOrderRequest carries no referral field',
      'complete_reward_referral_for_purchase is not defined in packages/schema or packages/engine',
    ], 'referral crediting preconditions changed -- re-read this file and decide whether the tripwire should go');
  });
});
