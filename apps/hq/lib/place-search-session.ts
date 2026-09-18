/**
 * The wizard's business search box, as a pure state machine its component
 * drives.
 *
 * A reducer because the rules that decide what Google bills live here, and a
 * reducer is the one shape of UI logic this app's tests can reach without a
 * renderer:
 *
 * - one session token covers every keystroke of a search;
 * - picking a suggestion ends the session with a Details call carrying that
 *   same token, which is what leaves the keystrokes unbilled;
 * - the token is replaced the moment Details answers, success or not, because
 *   an ended session's token is no longer valid -- reusing it would bill every
 *   later keystroke on its own.
 *
 * Answers are matched to the lookup that asked, so a slow reply to "harb"
 * never overwrites the list for "harbor roast".
 */
export const SEARCH_MIN = 3;
/** The proxy's bound, which is the engine's `PLACE_QUERY_MAX`. */
export const SEARCH_MAX = 200;
export const SEARCH_DEBOUNCE_MS = 250;

export type PlaceSuggestion = {
  readonly placeId: string;
  readonly mainText: string;
  readonly secondaryText: string | null;
};

export type SearchPhase =
  | 'idle' | 'typing' | 'loading' | 'open' | 'empty' | 'failed'
  | 'resolving' | 'picked' | 'unavailable';

export type SearchState = {
  readonly phase: SearchPhase;
  readonly query: string;
  /** The session every lookup in this search is billed under. */
  readonly token: string;
  readonly suggestions: readonly PlaceSuggestion[];
  /** The highlighted suggestion, or -1. */
  readonly active: number;
  /** The newest lookup's number; an answer to any other is stale. */
  readonly request: number;
  readonly message: string | null;
  readonly picked: PlaceSuggestion | null;
};

export type LookupFailure = { readonly reason: 'unavailable' | 'error'; readonly message: string };

export type SearchEvent =
  | { readonly type: 'typed'; readonly query: string }
  | { readonly type: 'searched'; readonly request: number }
  | { readonly type: 'answered'; readonly request: number; readonly suggestions: readonly PlaceSuggestion[] }
  | ({ readonly type: 'failed'; readonly request: number } & LookupFailure)
  | { readonly type: 'moved'; readonly by: 1 | -1 }
  | { readonly type: 'dismissed' }
  | { readonly type: 'chose'; readonly index: number }
  | { readonly type: 'resolved'; readonly token: string }
  | ({ readonly type: 'unresolved'; readonly token: string } & LookupFailure);

export function initialSearch(token: string): SearchState {
  return {
    phase: 'idle', query: '', token, suggestions: [], active: -1, request: 0, message: null, picked: null,
  };
}

function searchable(query: string): boolean {
  return query.trim().length >= SEARCH_MIN && query.length <= SEARCH_MAX;
}

/** Whether suggestions are on screen. A list stays up while the next lookup runs, so it never flickers. */
export function listOpen(state: SearchState): boolean {
  return state.suggestions.length > 0
    && (state.phase === 'open' || state.phase === 'typing' || state.phase === 'loading');
}

/** Whether a debounced lookup is waiting to be sent. */
export function shouldSearch(state: Pick<SearchState, 'phase'>): boolean {
  return state.phase === 'typing';
}

function moved(state: SearchState, by: 1 | -1): SearchState {
  const count = state.suggestions.length;
  if (!listOpen(state)) return state;
  const from = state.active >= 0 ? state.active : by > 0 ? -1 : count;
  return { ...state, active: (from + by + count) % count };
}

export function searchReducer(state: SearchState, event: SearchEvent): SearchState {
  switch (event.type) {
    case 'typed': {
      // Nothing is asked while a pick resolves, or once Places is known to be off.
      if (state.phase === 'resolving' || state.phase === 'unavailable') return state;
      const phase = searchable(event.query) ? 'typing' : 'idle';
      return {
        ...state, phase, query: event.query, active: -1, message: null, picked: null,
        suggestions: phase === 'typing' ? state.suggestions : [],
      };
    }
    case 'searched':
      return state.phase === 'typing' ? { ...state, phase: 'loading', request: event.request } : state;
    case 'answered':
      if (state.phase !== 'loading' || event.request !== state.request) return state;
      return {
        ...state, phase: event.suggestions.length > 0 ? 'open' : 'empty',
        suggestions: event.suggestions, active: -1,
      };
    case 'failed':
      if (state.phase !== 'loading' || event.request !== state.request) return state;
      return {
        ...state, phase: event.reason === 'unavailable' ? 'unavailable' : 'failed',
        suggestions: [], active: -1, message: event.message,
      };
    case 'moved':
      return moved(state, event.by);
    case 'dismissed':
      return listOpen(state) || state.phase === 'empty' || state.phase === 'typing' || state.phase === 'loading'
        ? { ...state, phase: 'idle', suggestions: [], active: -1 }
        : state;
    case 'chose': {
      const chosen = listOpen(state) ? state.suggestions[event.index] : undefined;
      if (!chosen) return state;
      return {
        ...state, phase: 'resolving', picked: chosen, query: chosen.mainText,
        suggestions: [], active: -1, message: null,
      };
    }
    case 'resolved':
      return state.phase === 'resolving' ? { ...state, phase: 'picked', token: event.token } : state;
    case 'unresolved':
      if (state.phase !== 'resolving') return state;
      return {
        ...state, token: event.token, picked: null, message: event.message,
        phase: event.reason === 'unavailable' ? 'unavailable' : 'failed',
      };
  }
}

/**
 * What a key does to the search, or null for the browser's own handling.
 * Enter only ever chooses: the search box sits inside the wizard's form, and
 * the component swallows a bare Enter so it can never submit the organization.
 */
export function keyEvent(key: string, state: SearchState): SearchEvent | null {
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    return listOpen(state) ? { type: 'moved', by: key === 'ArrowDown' ? 1 : -1 } : null;
  }
  if (key === 'Enter') return listOpen(state) && state.active >= 0 ? { type: 'chose', index: state.active } : null;
  if (key === 'Escape') {
    return listOpen(state) || state.phase === 'empty' || state.phase === 'loading' ? { type: 'dismissed' } : null;
  }
  return null;
}

/** The sentence the status line reads out, so a screen reader hears what sighted users see. */
export function searchStatus(state: SearchState): string {
  const count = state.suggestions.length;
  switch (state.phase) {
    case 'loading': return count > 0 ? '' : 'Searching Google…';
    case 'open': return `${count} ${count === 1 ? 'match' : 'matches'}. Use the up and down arrows to choose one.`;
    case 'empty': return 'Google has no business by that name. Add the town, or enter the details by hand.';
    case 'failed':
    case 'unavailable': return state.message ?? '';
    case 'resolving': return `Filling in ${state.picked?.mainText ?? 'the business'} from Google…`;
    case 'picked': return `Filled in from Google: ${state.picked?.mainText ?? 'the business'}. Review each step before you create it.`;
    default: {
      const typed = state.query.trim().length;
      return typed > 0 && typed < SEARCH_MIN ? 'Keep typing: at least three characters.' : '';
    }
  }
}
