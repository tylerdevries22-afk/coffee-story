'use client';

import { useCallback, useRef, useState } from 'react';

import {
  editedField, MANUAL_PREFILL, needsConfirmation, prefillFromPlace, type PlacePrefill, type PrefillField,
} from '@/lib/place-prefill';
import type { PlaceDraft } from '@/lib/place-to-draft';

/**
 * Where the wizard's business details come from: nowhere yet (null), a
 * Google pick, or the operator's own typing.
 *
 * A pick Google marks as permanently closed is held back as `pending` until
 * the operator confirms it, so a dead listing never fills the form on its own.
 * `apply` receives each accepted pick to fill what the wizard itself holds,
 * and must be stable (a `useCallback` over state setters).
 */
export function usePlacePrefill(apply: (draft: PlaceDraft) => void, initial: PlacePrefill | null) {
  const [prefill, setPrefill] = useState<PlacePrefill | null>(initial);
  const [pending, setPending] = useState<PlaceDraft | null>(null);
  const picks = useRef(0);

  const accept = useCallback((draft: PlaceDraft) => {
    picks.current += 1;
    setPending(null);
    setPrefill(prefillFromPlace(draft, picks.current));
    apply(draft);
  }, [apply]);

  const resolved = useCallback((draft: PlaceDraft) => {
    if (needsConfirmation(draft)) setPending(draft);
    else accept(draft);
  }, [accept]);

  const confirm = useCallback(() => {
    if (pending) accept(pending);
  }, [accept, pending]);

  const discard = useCallback(() => setPending(null), []);

  /** Open the fields for typing; anything a pick already filled stays. */
  const manual = useCallback(() => {
    setPending(null);
    setPrefill((current) => current ?? MANUAL_PREFILL);
  }, []);

  const edited = useCallback((field: PrefillField) => {
    setPrefill((current) => (current ? editedField(current, field) : current));
  }, []);

  return { prefill, pending, resolved, confirm, discard, manual, edited };
}
