import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(
  join(process.cwd(), 'src', 'screens', 'client', 'more', 'platform-pages.tsx'),
  'utf8',
);

test('catering never flips to an optimistic "sent" state with no backend call', () => {
  // The regression this guards: `onPress={() => setSent(true)}` with no
  // mobileApi/fetch/supabase call anywhere in the file -- a fake success the
  // shop never receives. There is no catering-request backend at all today
  // (see features/catering-request.ts), so the screen must not claim one.
  assert.doesNotMatch(source, /setSent\(true\)/);
  assert.doesNotMatch(source, /useState\(false\)/);
  assert.doesNotMatch(source, /request received/i);
});

test('catering points the guest at a real channel instead of a fake form', () => {
  assert.match(source, /CATERING_UNAVAILABLE_MESSAGE/);
  assert.match(source, /cateringPhoneHref\(BUSINESS\.phone\)/);
  assert.match(source, /cateringEmailHref\(BUSINESS\.email\)/);
});

test('referral copy no longer claims automatic application', () => {
  // The regression this guards: "Code X will be applied to your first order.
  // Nothing else to do" and "you each get a free drink loaded onto your
  // rewards" -- neither PlaceOrderRequest nor any schema/engine function
  // credits a referral automatically (see
  // tests/consistency/src/referral-capability-preconditions.test.ts).
  assert.doesNotMatch(source, /will be applied to your first order/i);
  assert.doesNotMatch(source, /nothing else to\s*\n?\s*do/i);
  assert.doesNotMatch(source, /loaded onto your rewards/i);
  assert.match(source, /referralIncomingMessage/);
  assert.match(source, /REFERRAL_SHARE_EXPLAINER/);
});
