import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NotificationItem } from './feed';
import { groupNotifications, relativeAge } from './feed';

const NOW = new Date('2026-08-01T12:00:00.000Z');

function item(id: string, at: string): NotificationItem {
  return {
    id,
    actor: 'Coffee Story',
    title: 'Something happened',
    detail: 'Detail line',
    at,
    target: { kind: 'visits' },
  };
}

describe('groupNotifications', () => {
  it('leads with unread rows under New, whatever their age', () => {
    const old = item('old', '2026-05-01T12:00:00.000Z');
    const fresh = item('fresh', '2026-08-01T11:00:00.000Z');
    const sections = groupNotifications([old, fresh], NOW, new Set(['old']));
    assert.equal(sections[0].title, 'New');
    assert.deepEqual(sections[0].items.map((entry) => entry.id), ['old']);
  });

  it('buckets read rows by widening age', () => {
    const sections = groupNotifications([
      item('today', '2026-08-01T09:00:00.000Z'),
      item('week', '2026-07-29T09:00:00.000Z'),
      item('month', '2026-07-10T09:00:00.000Z'),
      item('earlier', '2026-01-10T09:00:00.000Z'),
    ], NOW);
    assert.deepEqual(sections.map((section) => section.title), ['Today', 'This week', 'This month', 'Earlier']);
    assert.deepEqual(sections.map((section) => section.items[0].id), ['today', 'week', 'month', 'earlier']);
  });

  it('drops empty buckets rather than showing bare headers', () => {
    const sections = groupNotifications([item('today', '2026-08-01T09:00:00.000Z')], NOW);
    assert.deepEqual(sections.map((section) => section.title), ['Today']);
  });

  it('orders newest first inside a bucket', () => {
    const sections = groupNotifications([
      item('older', '2026-08-01T02:00:00.000Z'),
      item('newer', '2026-08-01T10:00:00.000Z'),
    ], NOW);
    assert.deepEqual(sections[0].items.map((entry) => entry.id), ['newer', 'older']);
  });

  it('returns nothing for an empty feed', () => {
    assert.deepEqual(groupNotifications([], NOW), []);
  });
});

describe('relativeAge', () => {
  it('counts minutes, hours, days and weeks, then falls back to a date', () => {
    assert.equal(relativeAge('2026-08-01T11:45:00.000Z', NOW), '15m');
    assert.equal(relativeAge('2026-08-01T09:00:00.000Z', NOW), '3h');
    assert.equal(relativeAge('2026-07-30T12:00:00.000Z', NOW), '2d');
    assert.equal(relativeAge('2026-07-11T12:00:00.000Z', NOW), '3w');
    assert.equal(relativeAge('2026-01-10T12:00:00.000Z', NOW), 'Jan 10');
  });

  it('never reports zero minutes for something that just happened', () => {
    assert.equal(relativeAge('2026-08-01T11:59:50.000Z', NOW), '1m');
  });
});
