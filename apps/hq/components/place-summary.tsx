import { hoursSummary } from '@/lib/location-hours';
import type { PlaceDraft } from '@/lib/place-to-draft';

const UNLISTED = 'Not on the listing';

/**
 * What the Google listing said, as it said it. The editable copies are on
 * the final step; this stays put so the operator can compare against it.
 */
export function PlaceSummary({ draft }: { readonly draft: PlaceDraft }) {
  const address = [draft.street, draft.city, draft.region, draft.postal].filter(Boolean).join(', ');
  const rows: readonly [string, string | null][] = [
    ['Address', address || null],
    ['Phone', draft.phone],
    ['Website', draft.website],
    ['Hours', draft.hours ? hoursSummary(draft.hours) : null],
    ['Time zone', draft.timezone],
  ];
  return (
    <section className="place-summary" aria-labelledby="place-summary-name">
      <header>
        <p className="onboarding-kicker">On Google</p>
        <h3 id="place-summary-name">{draft.name}</h3>
      </header>
      <dl>
        {rows.map(([term, value]) => (
          <div key={term}><dt>{term}</dt><dd className={value ? undefined : 'unlisted'}>{value ?? UNLISTED}</dd></div>
        ))}
      </dl>
      {draft.warnings.length > 0 ? (
        <ul className="place-warnings" aria-label="Check before you continue">
          {draft.warnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}
        </ul>
      ) : null}
      <p className="place-attribution">Google Maps</p>
    </section>
  );
}
