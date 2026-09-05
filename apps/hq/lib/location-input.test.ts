import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLocationDraft } from './location-input';

const valid = {
  name: 'River North',
  city: 'Chicago',
  region: 'IL',
  timezone: 'America/Chicago',
  openTime: '08:00',
  closeTime: '20:00',
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
};

test('a complete form parses into a row-ready draft', () => {
  const result = parseLocationDraft(valid);
  assert.ok(result.ok);
  assert.equal(result.draft.name, 'River North');
  assert.equal(result.draft.city, 'Chicago');
  assert.equal(result.draft.timezone, 'America/Chicago');
  assert.deepEqual(result.draft.hours.mon, [{ open: '08:00', close: '20:00' }]);
  assert.equal(result.draft.hours.sat, undefined);
  assert.match(result.draft.hoursSummary, /Mon Tue Wed Thu Fri 08:00–20:00/);
});

test('a missing name is the first thing flagged', () => {
  const result = parseLocationDraft({ ...valid, name: '  ' });
  assert.equal(result.ok, false);
});

test('a non-IANA timezone is rejected', () => {
  const result = parseLocationDraft({ ...valid, timezone: 'Central' });
  assert.equal(result.ok, false);
});

test('a timezone-shaped value missing from the IANA database is rejected', () => {
  const result = parseLocationDraft({ ...valid, timezone: 'Mars/Olympus' });
  assert.equal(result.ok, false);
});

test('a multi-segment IANA zone is accepted', () => {
  const result = parseLocationDraft({ ...valid, timezone: 'America/Argentina/Salta' });
  assert.ok(result.ok);
});

test('a shaped but unknown timezone is rejected', () => {
  const result = parseLocationDraft({ ...valid, timezone: 'America/Definitely_Not_A_Zone' });
  assert.equal(result.ok, false);
});

test('close before open is rejected', () => {
  const result = parseLocationDraft({ ...valid, openTime: '20:00', closeTime: '08:00' });
  assert.deepEqual(result, { ok: false, field: 'closeTime',
    error: 'Closing time has to be after opening time.' });
});

test('a malformed time is rejected', () => {
  const result = parseLocationDraft({ ...valid, openTime: '8am' });
  assert.equal(result.ok, false);
});

test('no open days is rejected', () => {
  const result = parseLocationDraft({ ...valid, days: [] });
  assert.deepEqual(result, { ok: false, field: 'days',
    error: 'Pick at least one day the location is open.' });
});

test('address fields left blank stay undefined, not empty strings', () => {
  const result = parseLocationDraft({ ...valid, street: '', region: '' });
  assert.ok(result.ok);
  assert.equal(result.draft.address.street, undefined);
  assert.equal(result.draft.address.region, undefined);
});
