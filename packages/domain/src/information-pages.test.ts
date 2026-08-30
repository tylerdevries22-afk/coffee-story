import assert from 'node:assert/strict';
import { test } from 'node:test';

import coffeeStory from '../../../tenants/coffee-story/brand.json';
import {
  formatClockLabel, resolveInformationPages, summarizeWeek,
} from './information-pages';

const KEYS = ['location', 'resources', 'faq', 'order-policy', 'privacy'];

test('information pages preserve every More destination, for any tenant', () => {
  // Including a tenant that configured nothing at all: these keys are routes,
  // and a missing one is a screen that cannot render.
  assert.deepEqual(Object.keys(resolveInformationPages(coffeeStory)), KEYS);
  assert.deepEqual(Object.keys(resolveInformationPages(null)), KEYS);
  assert.deepEqual(Object.keys(resolveInformationPages({ information: 'nonsense' })), KEYS);
});

test('every information page has display copy, rows, and a web destination', () => {
  for (const page of Object.values(resolveInformationPages(coffeeStory))) {
    assert.ok(page.eyebrow && page.title && page.summary);
    assert.ok(page.rows.length > 0);
    assert.match(page.webPath ?? '', /^\//);
    assert.ok(page.action);
  }
});

test('the FAQ keeps the stored-value rewards caveat', () => {
  const faq = resolveInformationPages(coffeeStory).faq;
  assert.match(
    faq.rows.find((row) => row.title.includes('rewards'))?.detail ?? '',
    /stored value/,
  );
  // And so does the default a brand-new tenant gets, since the caveat is a
  // property of how stored value works, not of one shop's wording.
  assert.match(
    resolveInformationPages(null).faq.rows.find((row) => row.title.includes('rewards'))?.detail ?? '',
    /stored value/,
  );
});

test('nobody else ships Coffee Story', () => {
  const other = resolveInformationPages({
    identity: { name: 'Second Shop' },
    business: { phone: '(555) 0100', email: 'hi@second.example' },
    location: {
      address: { street: '1 High St', city: 'Leeds', region: 'LS', postal: 'LS1 1AA' },
      hours: { mon: [{ open: '07:00', close: '15:00' }] },
    },
  });
  const rendered = JSON.stringify(other);
  assert.doesNotMatch(rendered, /Coffee Story|Havana|Aurora|Corvus|720/);
  assert.match(rendered, /Second Shop/);
  // The address a tenant already maintains, not a second copy of it in prose.
  assert.match(other.location.rows[0]?.detail ?? '', /1 High St, Leeds, LS LS1 1AA · \(555\) 0100/);
});

test('the location page is derived from the fields a tenant already fills in', () => {
  const page = resolveInformationPages(coffeeStory).location;
  const detail = page.rows.map((row) => row.detail).join(' | ');
  assert.match(detail, /2222 S Havana St Unit A1, Aurora, CO 80014/);
  assert.match(detail, /\(720\) 609-2971/);
  // Written once in brand.json's structured hours, printed here.
  assert.match(detail, /Monday–Thursday 8am–11pm/);
  assert.match(detail, /Friday–Saturday 8am–12am/);
  // addRows appends to the derived rows rather than replacing them.
  assert.match(detail, /prayer room/);
});

test('hours read the way a door reads, not the way a database stores them', () => {
  assert.equal(formatClockLabel('08:00'), '8am');
  assert.equal(formatClockLabel('12:00'), '12pm');
  assert.equal(formatClockLabel('23:30'), '11:30pm');
  // Past-midnight closes are stored beyond 24:00 so a span stays ordered.
  assert.equal(formatClockLabel('24:00'), '12am');
  assert.equal(formatClockLabel('25:30'), '1:30am');
  // Unparseable is returned as written: a guessed closing time is worse.
  assert.equal(formatClockLabel('late'), 'late');
});

test('a week of identical hours reads as one line', () => {
  const same = Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, [{ open: '08:00', close: '18:00' }]]),
  );
  assert.equal(summarizeWeek(same), 'Every day 8am–6pm');
  // A missing day is not an empty day: refuse rather than print a wrong week.
  assert.equal(summarizeWeek({ ...same, sun: undefined }), null);
  assert.equal(summarizeWeek(null), null);
});

test('tenant rows replace, addRows append', () => {
  const config = { identity: { name: 'Shop' }, information: {
    faq: { rows: [{ title: 'Only', detail: 'One' }] },
    privacy: { addRows: [{ title: 'Extra', detail: 'Row' }] },
  } };
  const pages = resolveInformationPages(config);
  assert.deepEqual(pages.faq.rows, [{ title: 'Only', detail: 'One' }]);
  assert.equal(pages.privacy.rows.length, resolveInformationPages(null).privacy.rows.length + 1);
  assert.equal(pages.privacy.rows.at(-1)?.title, 'Extra');
  // A malformed row is dropped, not rendered as "undefined" on a guest's screen.
  assert.deepEqual(
    resolveInformationPages({ information: { faq: { rows: [{ title: 'No detail' }] } } }).faq.rows,
    resolveInformationPages(null).faq.rows,
  );
});
