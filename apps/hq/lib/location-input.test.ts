import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLocationDraft, type LocationInput } from './location-input';

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
  assert.equal(result.draft.googlePlaceId, null);
  assert.equal(result.draft.phone, null);
  assert.equal(result.draft.website, null);
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

test('a close before the open is an overnight span, kept on the day it opens', () => {
  // Used to be rejected by a string compare, which made every bar and late
  // kitchen impossible to enter.
  const result = parseLocationDraft({ ...valid, openTime: '20:00', closeTime: '02:00', days: ['fri', 'sat'] });
  assert.ok(result.ok);
  assert.deepEqual(result.draft.hours, {
    fri: [{ open: '20:00', close: '02:00' }], sat: [{ open: '20:00', close: '02:00' }],
  });
  assert.equal(result.draft.hoursSummary, 'Fri Sat 20:00–02:00');
});

test('a span that opens and closes at the same minute is still rejected', () => {
  const result = parseLocationDraft({ ...valid, openTime: '08:00', closeTime: '08:00' });
  assert.deepEqual(result, { ok: false, field: 'closeTime',
    error: 'Opening and closing times can’t be the same. For a location that never closes, use 00:00 to 23:59.' });
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
  assert.equal('lat' in result.draft.address, false);
});

test('per-day spans replace the quick form and keep each day its own hours', () => {
  const hours = JSON.stringify({
    mon: [{ open: '07:00', close: '15:00' }],
    tue: [{ open: '07:00', close: '15:00' }],
    sat: [{ open: '13:00', close: '17:00' }, { open: '08:00', close: '12:00' }],
    sun: [],
  });
  const result = parseLocationDraft({ ...valid, openTime: '', closeTime: '', days: [], hours });
  assert.ok(result.ok);
  assert.deepEqual(result.draft.hours, {
    mon: [{ open: '07:00', close: '15:00' }],
    tue: [{ open: '07:00', close: '15:00' }],
    sat: [{ open: '08:00', close: '12:00' }, { open: '13:00', close: '17:00' }],
  });
  assert.equal(result.draft.hoursSummary, 'Mon Tue 07:00–15:00 · Sat 08:00–12:00, 13:00–17:00');
});

test('an around-the-clock day reads as 24 hours', () => {
  const result = parseLocationDraft({
    ...valid, hours: { sat: [{ open: '00:00', close: '23:59' }], sun: [{ open: '00:00', close: '23:59' }] },
  });
  assert.ok(result.ok);
  assert.equal(result.draft.hoursSummary, 'Sat Sun 24 hours');
});

test('malformed per-day hours are refused against the hours field, never dropped', () => {
  const cases: readonly [unknown, RegExp][] = [
    ['{not json', /could not be read/],
    [JSON.stringify({ funday: [] }), /could not be read/],
    [JSON.stringify({ mon: [{ open: '08:00' }] }), /could not be read/],
    [JSON.stringify({ mon: 'all day' }), /could not be read/],
    [JSON.stringify({ mon: [{ open: '8', close: '17:00' }] }), /^Monday: Enter each opening/],
    [JSON.stringify({ tue: [{ open: '09:00', close: '09:00' }] }), /^Tuesday: Opening and closing/],
    [JSON.stringify({ fri: [{ open: '08:00', close: '14:00' }, { open: '12:00', close: '18:00' }] }), /^Friday: Two sets/],
    // An overnight span is still open at every later opening that day.
    [JSON.stringify({ sat: [{ open: '22:00', close: '02:00' }, { open: '23:00', close: '23:30' }] }), /^Saturday: Two sets/],
    [JSON.stringify({ sun: Array.from({ length: 5 }, (_, index) => ({ open: `0${index}:00`, close: `0${index}:30` })) }), /^Sunday: List at most 4/],
    [JSON.stringify({ mon: [], tue: [] }), /^Pick at least one day/],
    ['x'.repeat(5_000), /could not be read/],
  ];
  for (const [hours, message] of cases) {
    const result = parseLocationDraft({ ...valid, hours });
    assert.equal(result.ok, false, String(hours).slice(0, 60));
    if (result.ok) continue;
    assert.equal(result.field, 'hours');
    assert.match(result.error, message);
  }
});

test('the Google Place, map position, phone and website ride along when valid', () => {
  const result = parseLocationDraft({
    ...valid, googlePlaceId: 'ChIJExamplePlace_01', lat: '41.8925', lng: '-87.6262',
    phone: '+1 312-555-0100', website: 'https://river-north.example.com/',
  });
  assert.ok(result.ok);
  assert.equal(result.draft.googlePlaceId, 'ChIJExamplePlace_01');
  assert.deepEqual(result.draft.address, {
    street: undefined, city: 'Chicago', region: 'IL', postal: undefined, lat: 41.8925, lng: -87.6262,
  });
  assert.equal(result.draft.phone, '+1 312-555-0100');
  assert.equal(result.draft.website, 'https://river-north.example.com/');
});

test('each new field is refused against its own field when malformed', () => {
  const cases: readonly [Partial<LocationInput>, string][] = [
    [{ googlePlaceId: 'bad id!' }, 'googlePlaceId'],
    [{ lat: '41.9' }, 'coordinates'],
    [{ lat: '91', lng: '0' }, 'coordinates'],
    [{ lat: 'north', lng: '0' }, 'coordinates'],
    [{ phone: '12345' }, 'phone'],
    [{ phone: 'call us' }, 'phone'],
    [{ website: 'http://river-north.example.com' }, 'website'],
    [{ website: 'https://127.0.0.1/' }, 'website'],
  ];
  for (const [overrides, field] of cases) {
    const result = parseLocationDraft({ ...valid, ...overrides });
    assert.equal(result.ok, false, JSON.stringify(overrides));
    if (!result.ok) assert.equal(result.field, field, JSON.stringify(overrides));
  }
});
