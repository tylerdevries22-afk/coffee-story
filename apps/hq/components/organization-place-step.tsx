'use client';

import type { IndustryKey } from '@/lib/org-input';
import type { PlacePrefill } from '@/lib/place-prefill';
import type { PlaceDraft } from '@/lib/place-to-draft';

import { OrganizationIndustryChoices } from './organization-industry-choices';
import { PLACE_SEARCH_INPUT_ID, PlaceSearch } from './place-search';
import { PlaceSummary } from './place-summary';

type PlaceStepProps = {
  /** This deployment has a Places key; without one the step opens for typing. */
  readonly placesReady: boolean;
  readonly prefill: PlacePrefill | null;
  /** A pick Google marks permanently closed, waiting on the operator. */
  readonly pending: PlaceDraft | null;
  readonly industry: IndustryKey | null;
  readonly onResolved: (draft: PlaceDraft) => void;
  readonly onConfirm: () => void;
  readonly onDiscard: () => void;
  readonly onManual: () => void;
  readonly onIndustryChange: (industry: IndustryKey) => void;
};

/** The buttons that settle it unmount with it, so focus goes back to the search. */
function refocusSearch() {
  requestAnimationFrame(() => document.getElementById(PLACE_SEARCH_INPUT_ID)?.focus());
}

function ClosedListing({ draft, onConfirm, onDiscard }: {
  readonly draft: PlaceDraft;
  readonly onConfirm: () => void;
  readonly onDiscard: () => void;
}) {
  const warning = draft.warnings.find((entry) => entry.code === 'closed_permanently');
  return (
    <div className="place-closed" role="alert">
      <p><strong>{draft.name}.</strong> {warning?.message}</p>
      <div>
        <button type="button" className="wizard-button secondary"
          onClick={() => { onDiscard(); refocusSearch(); }}>Search again</button>
        <button type="button" className="wizard-button"
          onClick={() => { onConfirm(); refocusSearch(); }}>Use this listing</button>
      </div>
    </div>
  );
}

/**
 * Step 0: find the business on Google, or say it will be typed by hand.
 * Nothing below the search opens until one of those happens, so the operator
 * is never filling in by hand what a pick would have filled a moment later.
 */
export function OrganizationPlaceStep(props: PlaceStepProps) {
  const draft = props.prefill?.draft ?? null;
  return (
    <section className="onboarding-step place-step" data-wizard-step="0" aria-labelledby="place-question">
      <div className="onboarding-question"><p className="onboarding-kicker">Business profile</p>
        <h2 id="place-question" tabIndex={-1}>Which business is this?</h2>
        <p>{props.placesReady
          ? 'Find it on Google to fill in its name, address, phone, website, hours and industry. You review every field before anything is created.'
          : 'Google Places is not set up on this console, so enter the business details by hand.'}</p></div>
      {props.placesReady ? (
        <div className="place-finder">
          <PlaceSearch onResolved={props.onResolved} onUnavailable={props.onManual} />
          {props.prefill === null ? (
            <p className="place-manual">Not on Google, or no listing fits?
              <button type="button" className="wizard-button secondary" onClick={props.onManual}>Enter details manually</button>
            </p>
          ) : null}
        </div>
      ) : null}
      {props.pending ? <ClosedListing draft={props.pending} onConfirm={props.onConfirm} onDiscard={props.onDiscard} /> : null}
      {draft ? <PlaceSummary draft={draft} /> : null}
      {props.prefill ? (
        <OrganizationIndustryChoices industry={props.industry} suggestion={draft?.industry ?? null}
          fromGoogle={props.prefill.fromGoogle.has('industry')} onChange={props.onIndustryChange} />
      ) : null}
    </section>
  );
}
