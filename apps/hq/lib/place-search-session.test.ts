import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PLACE_QUERY_MAX } from '@platform/engine';

import {
  initialSearch, keyEvent, listOpen, SEARCH_MAX, SEARCH_MIN, searchReducer, searchStatus, shouldSearch,
  type PlaceSuggestion, type SearchEvent, type SearchState,
} from './place-search-session';

const FIRST = 'aaaaaaaa-0000-4000-8000-000000000001';
const SECOND = 'aaaaaaaa-0000-4000-8000-000000000002';
const THIRD = 'aaaaaaaa-0000-4000-8000-000000000003';

const HARBOR: PlaceSuggestion = { placeId: 'ChIJHarborRoast0001', mainText: 'Harbor Roast', secondaryText: 'Tacoma, WA, USA' };
const HARBOR_TWO: PlaceSuggestion = { placeId: 'ChIJHarborRoast0002', mainText: 'Harbor Roast Annex', secondaryText: 'Olympia, WA, USA' };

function run(events: readonly SearchEvent[], from: SearchState = initialSearch(FIRST)): SearchState {
  return events.reduce(searchReducer, from);
}

/** Typed, searched as lookup `request`, and answered. */
function answered(query: string, suggestions: readonly PlaceSuggestion[], request = 1): SearchEvent[] {
  return [{ type: 'typed', query }, { type: 'searched', request }, { type: 'answered', request, suggestions }];
}

describe('one search, one session', () => {
  it('keeps one token for every keystroke of a search', () => {
    const state = run([
      ...answered('harb', [HARBOR], 1),
      ...answered('harbor ro', [HARBOR, HARBOR_TWO], 2),
    ]);
    assert.equal(state.token, FIRST);
    assert.equal(state.phase, 'open');
    assert.deepEqual(state.suggestions, [HARBOR, HARBOR_TWO]);
  });

  it('keeps the same token for the Details call, then starts a fresh one', () => {
    const chosen = run([...answered('harbor', [HARBOR]), { type: 'moved', by: 1 }, { type: 'chose', index: 0 }]);
    assert.equal(chosen.phase, 'resolving');
    assert.equal(chosen.token, FIRST, 'the pick must close the session its suggestions came from');
    assert.equal(chosen.query, 'Harbor Roast');
    const done = searchReducer(chosen, { type: 'resolved', token: SECOND });
    assert.equal(done.phase, 'picked');
    assert.equal(done.token, SECOND);
    const next = run([...answered('another shop', [HARBOR_TWO], 3)], done);
    assert.equal(next.token, SECOND, 'the next search is one new session, not one per keystroke');
  });

  it('replaces the token when Details fails too, because the session ended either way', () => {
    const chosen = run([...answered('harbor', [HARBOR]), { type: 'moved', by: 1 }, { type: 'chose', index: 0 }]);
    const failed = searchReducer(chosen, { type: 'unresolved', token: THIRD, reason: 'error', message: 'Try again.' });
    assert.equal(failed.token, THIRD);
    assert.equal(failed.phase, 'failed');
    assert.equal(failed.picked, null);
    assert.equal(searchStatus(failed), 'Try again.');
  });
});

describe('what gets asked', () => {
  it('waits for three characters and ignores a query past the proxy’s bound', () => {
    assert.equal(SEARCH_MIN, 3);
    assert.equal(SEARCH_MAX, PLACE_QUERY_MAX);
    assert.equal(shouldSearch(run([{ type: 'typed', query: 'ha' }])), false);
    assert.equal(shouldSearch(run([{ type: 'typed', query: '  ha  ' }])), false);
    assert.equal(shouldSearch(run([{ type: 'typed', query: 'har' }])), true);
    assert.equal(shouldSearch(run([{ type: 'typed', query: 'h'.repeat(SEARCH_MAX + 1) }])), false);
    assert.equal(searchStatus(run([{ type: 'typed', query: 'ha' }])), 'Keep typing: at least three characters.');
  });

  it('drops a slow answer to an older query', () => {
    const state = run([
      { type: 'typed', query: 'harb' }, { type: 'searched', request: 1 },
      { type: 'typed', query: 'harbor roast' }, { type: 'searched', request: 2 },
      { type: 'answered', request: 1, suggestions: [HARBOR_TWO] },
    ]);
    assert.equal(state.phase, 'loading');
    assert.deepEqual(state.suggestions, []);
    const current = searchReducer(state, { type: 'answered', request: 2, suggestions: [HARBOR] });
    assert.deepEqual(current.suggestions, [HARBOR]);
  });

  it('keeps the old list up while the next lookup runs, with nothing highlighted', () => {
    const state = run([...answered('harbor', [HARBOR, HARBOR_TWO]), { type: 'moved', by: 1 }, { type: 'typed', query: 'harbor r' }]);
    assert.equal(listOpen(state), true);
    assert.equal(state.active, -1);
  });

  it('says so when Google has nothing, and stops asking once Places is not set up', () => {
    assert.equal(run(answered('zzzz', [])).phase, 'empty');
    const off = run([{ type: 'typed', query: 'harbor' }, { type: 'searched', request: 1 },
      { type: 'failed', request: 1, reason: 'unavailable', message: 'Enter the details by hand.' }]);
    assert.equal(off.phase, 'unavailable');
    assert.equal(searchStatus(off), 'Enter the details by hand.');
    const typedAgain = searchReducer(off, { type: 'typed', query: 'harbor roast' });
    assert.equal(shouldSearch(typedAgain), false);
  });

  it('lets typing retry after an ordinary failure', () => {
    const failed = run([{ type: 'typed', query: 'harbor' }, { type: 'searched', request: 1 },
      { type: 'failed', request: 1, reason: 'error', message: 'Google Places did not answer.' }]);
    assert.equal(failed.phase, 'failed');
    assert.equal(shouldSearch(searchReducer(failed, { type: 'typed', query: 'harbor r' })), true);
  });
});

describe('the keyboard', () => {
  const open = run(answered('harbor', [HARBOR, HARBOR_TWO]));

  it('moves through the list and wraps at both ends', () => {
    const down = (state: SearchState) => searchReducer(state, { type: 'moved', by: 1 });
    const up = (state: SearchState) => searchReducer(state, { type: 'moved', by: -1 });
    assert.equal(down(open).active, 0);
    assert.equal(down(down(open)).active, 1);
    assert.equal(down(down(down(open))).active, 0);
    assert.equal(up(open).active, 1);
    assert.equal(up(down(open)).active, 1);
  });

  it('maps arrows, Enter and Escape, and leaves Enter alone with nothing highlighted', () => {
    assert.deepEqual(keyEvent('ArrowDown', open), { type: 'moved', by: 1 });
    assert.deepEqual(keyEvent('ArrowUp', open), { type: 'moved', by: -1 });
    assert.equal(keyEvent('Enter', open), null);
    assert.deepEqual(keyEvent('Enter', { ...open, active: 1 }), { type: 'chose', index: 1 });
    assert.deepEqual(keyEvent('Escape', open), { type: 'dismissed' });
    assert.equal(keyEvent('a', open), null);
    assert.equal(keyEvent('ArrowDown', initialSearch(FIRST)), null);
  });

  it('closes the list on Escape and ignores the lookup it interrupted', () => {
    const loading = run([{ type: 'typed', query: 'harbor' }, { type: 'searched', request: 1 }]);
    const dismissed = searchReducer(loading, { type: 'dismissed' });
    assert.equal(dismissed.phase, 'idle');
    assert.equal(searchReducer(dismissed, { type: 'answered', request: 1, suggestions: [HARBOR] }).phase, 'idle');
  });

  it('never chooses from a closed list or past its end', () => {
    assert.equal(searchReducer(open, { type: 'chose', index: 5 }).phase, 'open');
    const closed = searchReducer(open, { type: 'dismissed' });
    assert.equal(searchReducer(closed, { type: 'chose', index: 0 }).phase, 'idle');
  });

  it('reads the list out, and the pick', () => {
    assert.equal(searchStatus(open), '2 matches. Use the up and down arrows to choose one.');
    const picked = run([{ type: 'moved', by: 1 }, { type: 'chose', index: 0 }, { type: 'resolved', token: SECOND }], open);
    assert.match(searchStatus(picked), /^Filled in from Google: Harbor Roast\./);
  });
});
