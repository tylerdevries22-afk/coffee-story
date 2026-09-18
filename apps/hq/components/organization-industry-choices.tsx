'use client';

import { INDUSTRY_OPTIONS } from '@/lib/organization-onboarding';
import type { IndustryKey } from '@/lib/org-input';
import type { IndustryConfidence, IndustrySuggestion } from '@/lib/place-industry';

import { FromGoogle } from './field-label';
import { WizardIcon, type WizardIconName } from './wizard-icon';

// `hospitality` reuses the location marker rather than adding a name: every
// WizardIconName is a cell in one sprite sheet, so a new icon needs new art
// before it needs a key, and a venue reads correctly as a place on a map.
const INDUSTRY_ICONS: Readonly<Record<IndustryKey, WizardIconName>> = {
  construction: 'construction', 'coffee-shop': 'coffee', general: 'general',
  hospitality: 'location',
};

const CONFIDENCE: Readonly<Record<IndustryConfidence, string>> = {
  high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence',
};

type IndustryChoicesProps = {
  readonly industry: IndustryKey | null;
  /** What Google's categories point to, when a place was picked. */
  readonly suggestion: IndustrySuggestion | null;
  /** The suggestion still stands: the operator has not chosen for themselves. */
  readonly fromGoogle: boolean;
  readonly onChange: (industry: IndustryKey) => void;
};

function Suggestion({ suggestion, industry, fromGoogle }: Omit<IndustryChoicesProps, 'onChange' | 'suggestion'> & {
  readonly suggestion: IndustrySuggestion;
}) {
  const label = INDUSTRY_OPTIONS.find((option) => option.key === suggestion.key)?.label ?? suggestion.key;
  const kept = industry === suggestion.key;
  const next = !kept ? 'You chose another below.' : fromGoogle ? 'Choose another below if it is wrong.' : '';
  return (
    <p id="industry-suggestion" className={`industry-suggestion confidence-${suggestion.confidence}`}>
      <strong>Google suggests: {label}</strong>
      {kept && fromGoogle ? <FromGoogle /> : null}
      <span className="industry-confidence">{CONFIDENCE[suggestion.confidence]}</span>
      <span className="industry-reason">{suggestion.reason}{next ? ` ${next}` : ''}</span>
    </p>
  );
}

/**
 * The industry, which picks the blueprint. A Google pick preselects its
 * suggestion, but the whole set stays on screen with the confidence beside
 * it: a low-confidence guess should look like one, and overriding it should
 * never take more than one click.
 */
export function OrganizationIndustryChoices({ industry, suggestion, fromGoogle, onChange }: IndustryChoicesProps) {
  return (
    <div className="industry-choices">
      <h3 className="industry-heading">What kind of business is it?</h3>
      {suggestion ? <Suggestion suggestion={suggestion} industry={industry} fromGoogle={fromGoogle} /> : null}
      <fieldset className="industry-grid" aria-describedby={suggestion ? 'industry-suggestion' : undefined}>
        <legend className="sr-only">Business industry</legend>
        {INDUSTRY_OPTIONS.map((option) => (
          <label className={`industry-option${industry === option.key ? ' selected' : ''}`} key={option.key}>
            <input type="radio" name="industryKey" value={option.key} required
              checked={industry === option.key} onChange={() => onChange(option.key)} />
            <span className="industry-visual"><WizardIcon name={INDUSTRY_ICONS[option.key]} /></span>
            <span className="industry-copy">
              <strong>{option.label}</strong><small>{option.summary}</small>
              {suggestion?.key === option.key ? <em className="industry-suggested">Suggested</em> : null}
            </span>
            <span className="industry-check" aria-hidden="true">✓</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
