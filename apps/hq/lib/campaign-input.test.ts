import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCampaignDraft, type CampaignInput } from './campaign-input';

const BASE: CampaignInput = {
  name: 'Weekend drop reminder', channel: 'push', audience: 'all', message: 'It\'s back Friday.',
};

test('a well-formed push draft parses with an empty subject', () => {
  const result = parseCampaignDraft(BASE);
  assert.ok(result.ok);
  assert.equal(result.draft.name, 'Weekend drop reminder');
  assert.equal(result.draft.channel, 'push');
  assert.deepEqual(result.draft.audience, { kind: 'all' });
  assert.equal(result.draft.subject, '');
  assert.equal(result.draft.scheduledAt, null);
});

test('maps each audience key to the shape the engine documents', () => {
  const lapsed = parseCampaignDraft({ ...BASE, audience: 'lapsed_30' });
  assert.ok(lapsed.ok);
  assert.deepEqual(lapsed.draft.audience, { kind: 'lapsed', days: 30 });

  const loyalty = parseCampaignDraft({ ...BASE, audience: 'loyalty_500' });
  assert.ok(loyalty.ok);
  assert.deepEqual(loyalty.draft.audience, { kind: 'loyalty_tier', min_points: 500 });
});

test('refuses an empty campaign name', () => {
  const result = parseCampaignDraft({ ...BASE, name: '   ' });
  assert.equal(result.ok, false);
});

test('refuses a channel outside app.campaign_channel', () => {
  const result = parseCampaignDraft({ ...BASE, channel: 'carrier-pigeon' });
  assert.equal(result.ok, false);
});

test('refuses an audience key with no known shape', () => {
  const result = parseCampaignDraft({ ...BASE, audience: 'everyone-ever' });
  assert.equal(result.ok, false);
});

test('refuses an empty message', () => {
  const result = parseCampaignDraft({ ...BASE, message: '' });
  assert.equal(result.ok, false);
});

test('requires a subject for an email campaign but not for push or sms', () => {
  const email = parseCampaignDraft({ ...BASE, channel: 'email', subject: '' });
  assert.equal(email.ok, false);

  const emailWithSubject = parseCampaignDraft({ ...BASE, channel: 'email', subject: 'It\'s back' });
  assert.ok(emailWithSubject.ok);
  assert.equal(emailWithSubject.draft.subject, 'It\'s back');

  const sms = parseCampaignDraft({ ...BASE, channel: 'sms', subject: '' });
  assert.ok(sms.ok);
});

test('parses an optional schedule and refuses an unparsable one', () => {
  const scheduled = parseCampaignDraft({ ...BASE, scheduledAt: '2026-10-03T08:00' });
  assert.ok(scheduled.ok);
  assert.equal(scheduled.draft.scheduledAt, new Date('2026-10-03T08:00').toISOString());

  const badSchedule = parseCampaignDraft({ ...BASE, scheduledAt: 'not-a-date' });
  assert.equal(badSchedule.ok, false);
});
