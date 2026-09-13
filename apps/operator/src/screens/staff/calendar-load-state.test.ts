import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calendarLoadFailed,
  calendarLoaded,
  calendarLoading,
  scheduleDisplay,
} from './calendar-load-state';

test('calendarLoading is the loading status', () => {
  assert.deepEqual(calendarLoading(), { status: 'loading' });
});

test('calendarLoaded carries the fetched items', () => {
  const items = [{ id: 'a' }] as never;
  assert.deepEqual(calendarLoaded(items), { status: 'loaded', items });
});

test('calendarLoadFailed carries the error message when there is one', () => {
  const state = calendarLoadFailed(new Error('Calendar could not be loaded: timeout'));
  assert.deepEqual(state, { status: 'error', message: 'Calendar could not be loaded: timeout' });
});

test('calendarLoadFailed falls back to a generic message for a non-Error rejection', () => {
  const state = calendarLoadFailed('offline');
  assert.deepEqual(state, {
    status: 'error',
    message: 'Could not load the calendar. Check your connection and try again.',
  });
});

test('scheduleDisplay shows loading while the fetch is in flight, regardless of visible count', () => {
  assert.equal(scheduleDisplay(calendarLoading(), 0), 'loading');
  assert.equal(scheduleDisplay(calendarLoading(), 3), 'loading');
});

test('scheduleDisplay shows error on a failed fetch, regardless of visible count', () => {
  const failed = calendarLoadFailed(new Error('down'));
  assert.equal(scheduleDisplay(failed, 0), 'error');
  assert.equal(scheduleDisplay(failed, 3), 'error');
});

test('scheduleDisplay only reads empty after a successful, genuinely empty fetch', () => {
  assert.equal(scheduleDisplay(calendarLoaded([]), 0), 'empty');
});

test('scheduleDisplay shows items once loaded with visible entries', () => {
  assert.equal(scheduleDisplay(calendarLoaded([{ id: 'a' } as never]), 1), 'items');
});
