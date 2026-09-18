'use client';

import { useEffect, useReducer, useRef, type KeyboardEvent } from 'react';

import { resolvePlace, suggestPlaces } from '@/lib/place-lookup';
import {
  initialSearch, keyEvent, listOpen, SEARCH_DEBOUNCE_MS, SEARCH_MAX, searchReducer, searchStatus,
} from '@/lib/place-search-session';
import type { PlaceDraft } from '@/lib/place-to-draft';

type PlaceSearchProps = {
  readonly onResolved: (draft: PlaceDraft) => void;
  /** Places is not set up here: the wizard opens its manual fields instead. */
  readonly onUnavailable: () => void;
};

/** The search box, for the wizard to send focus back to. */
export const PLACE_SEARCH_INPUT_ID = 'place-search-input';
const LIST_ID = 'place-search-options';
const STATUS_ID = 'place-search-status';
const optionId = (index: number) => `place-search-option-${index}`;

/** A v4 UUID is 36 URL-safe characters: exactly the session token Google accepts. */
const newToken = () => crypto.randomUUID();

/**
 * The business search: a combobox over Google's suggestions, one billed
 * lookup per business (see lib/place-search-session.ts for why the token
 * handling is what it is).
 */
export function PlaceSearch({ onResolved, onUnavailable }: PlaceSearchProps) {
  const [state, dispatch] = useReducer(searchReducer, undefined, () => initialSearch(newToken()));
  const requests = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const announced = useRef(false);
  const { phase, query, token } = state;

  // One lookup per pause in typing; a newer one abandons the older.
  useEffect(() => {
    if (phase !== 'typing') return;
    const timer = setTimeout(() => {
      const request = requests.current + 1;
      requests.current = request;
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      dispatch({ type: 'searched', request });
      suggestPlaces(query.trim(), token, controller.signal).then((answer) => dispatch(answer.ok
        ? { type: 'answered', request, suggestions: answer.value }
        : { type: 'failed', request, reason: answer.reason, message: answer.message }),
      () => undefined);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [phase, query, token]);

  useEffect(() => () => inflight.current?.abort(), []);

  useEffect(() => {
    if (phase !== 'unavailable' || announced.current) return;
    announced.current = true;
    onUnavailable();
  }, [phase, onUnavailable]);

  const choose = (index: number) => {
    const chosen = listOpen(state) ? state.suggestions[index] : undefined;
    if (!chosen) return;
    // The session the suggestions came from; the reducer keeps it until Details answers.
    const sessionToken = state.token;
    dispatch({ type: 'chose', index });
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    resolvePlace(chosen.placeId, sessionToken, controller.signal).then((answer) => {
      if (!answer.ok) {
        dispatch({ type: 'unresolved', token: newToken(), reason: answer.reason, message: answer.message });
        return;
      }
      dispatch({ type: 'resolved', token: newToken() });
      onResolved(answer.value);
    }, () => dispatch({
      type: 'unresolved', token: newToken(), reason: 'error',
      message: 'The lookup was interrupted. Choose the business again.',
    }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // The box sits inside the wizard's form: Enter here must never submit it.
    if (event.key === 'Enter') event.preventDefault();
    const next = keyEvent(event.key, state);
    if (!next) return;
    event.preventDefault();
    if (next.type === 'chose') choose(next.index);
    else dispatch(next);
  };

  const open = listOpen(state);
  return (
    <div className="place-search">
      <label htmlFor={PLACE_SEARCH_INPUT_ID}>Find the business on Google</label>
      <div className="place-search-field">
        <input id={PLACE_SEARCH_INPUT_ID} type="text" role="combobox" autoComplete="off" spellCheck={false}
          aria-autocomplete="list" aria-expanded={open} aria-controls={LIST_ID}
          aria-activedescendant={open && state.active >= 0 ? optionId(state.active) : undefined}
          aria-describedby={STATUS_ID} aria-busy={phase === 'loading' || phase === 'resolving'}
          maxLength={SEARCH_MAX} value={query} placeholder="Business name, then the town"
          disabled={phase === 'unavailable'} readOnly={phase === 'resolving'}
          onChange={(event) => dispatch({ type: 'typed', query: event.target.value })}
          onKeyDown={onKeyDown} onBlur={() => dispatch({ type: 'dismissed' })} />
        <div className="place-search-popup" hidden={!open}>
          <ul id={LIST_ID} role="listbox" aria-label="Businesses on Google">
            {open ? state.suggestions.map((suggestion, index) => (
              <li key={suggestion.placeId} id={optionId(index)} role="option" aria-selected={index === state.active}
                className={index === state.active ? 'active' : undefined}
                // mousedown, not click: the input would blur first and close the list.
                onMouseDown={(event) => { event.preventDefault(); choose(index); }}>
                <strong>{suggestion.mainText}</strong>
                {suggestion.secondaryText ? <span>{suggestion.secondaryText}</span> : null}
              </li>
            )) : null}
          </ul>
          {/* Google's terms: predictions shown without a map carry its attribution. */}
          <p className="place-search-attribution">Google Maps</p>
        </div>
      </div>
      <p id={STATUS_ID} className="place-search-status" role="status">{searchStatus(state)}</p>
    </div>
  );
}
