import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDropDraft, type DropInput } from './drop-input';

const ITEM = '11111111-1111-4111-8111-111111111111';
const BASE: DropInput = { itemId: ITEM, startsAt: '2026-10-01T09:00', endsAt: '2026-10-05T21:00' };

test('a well-formed draft parses to ISO timestamps', () => {
  const result = parseDropDraft(BASE);
  assert.ok(result.ok);
  assert.equal(result.draft.itemId, ITEM);
  assert.equal(result.draft.startsAt, new Date(BASE.startsAt as string).toISOString());
  assert.equal(result.draft.endsAt, new Date(BASE.endsAt as string).toISOString());
});

test('refuses a missing or malformed item id', () => {
  assert.equal(parseDropDraft({ ...BASE, itemId: '' }).ok, false);
  assert.equal(parseDropDraft({ ...BASE, itemId: 'not-a-uuid' }).ok, false);
  assert.equal(parseDropDraft({ ...BASE, itemId: undefined }).ok, false);
});

test('refuses an unparsable start or end date', () => {
  const badStart = parseDropDraft({ ...BASE, startsAt: 'not-a-date' });
  assert.equal(badStart.ok, false);
  if (!badStart.ok) assert.match(badStart.error, /start/);

  const badEnd = parseDropDraft({ ...BASE, endsAt: '' });
  assert.equal(badEnd.ok, false);
  if (!badEnd.ok) assert.match(badEnd.error, /end/);
});

test('refuses dates that are not ordered', () => {
  const same = parseDropDraft({ ...BASE, startsAt: '2026-10-05T21:00', endsAt: '2026-10-05T21:00' });
  assert.equal(same.ok, false);
  if (!same.ok) assert.match(same.error, /end after it starts/);

  const reversed = parseDropDraft({ ...BASE, startsAt: '2026-10-05T21:00', endsAt: '2026-10-01T09:00' });
  assert.equal(reversed.ok, false);
});
