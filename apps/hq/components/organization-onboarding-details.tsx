'use client';

import { WEEKDAYS } from '@/lib/location-input';
import type { BusinessStepField } from '@/lib/organization-business-step';
import { INDUSTRY_OPTIONS } from '@/lib/organization-onboarding';
import type { IndustryKey, OrganizationKind } from '@/lib/org-input';

import { WizardIcon, type WizardIconName } from './wizard-icon';

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix',
  'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'Europe/London', 'Europe/Paris', 'Australia/Sydney',
];

const ORGANIZATION_MODELS: readonly [OrganizationKind, string, string, WizardIconName][] = [
  ['independent', 'Independent', 'One business with its own locations.', 'independent'],
  ['franchisor', 'Franchise network', 'A brand that governs many organizations.', 'franchise'],
  ['franchisee', 'Franchise location', 'A business joining an existing network.', 'location'],
  ['operator', 'Management operator', 'A team operating locations for other owners.', 'operations'],
];

const INDUSTRY_ICONS: Readonly<Record<IndustryKey, WizardIconName>> = {
  construction: 'construction', 'coffee-shop': 'coffee', general: 'general',
};

type DetailsProps = {
  readonly mode: 'profile' | 'model' | 'details';
  readonly name: string;
  readonly industry: IndustryKey | null;
  readonly kind: OrganizationKind;
  readonly ownerEmail: string;
  readonly onIndustryChange: (industry: IndustryKey) => void;
  readonly onKindChange: (kind: OrganizationKind) => void;
  readonly onNameChange: (name: string) => void;
  readonly invalidField: BusinessStepField | null;
};

function ModelChoices({ kind, onChange }: {
  readonly kind: OrganizationKind;
  readonly onChange: (kind: OrganizationKind) => void;
}) {
  return <fieldset className="onboarding-card model-card"><legend className="sr-only">Organization model</legend>
    <header><span>02</span><div><strong>Organization model</strong><p>Choose how this business is governed.</p></div></header>
    <div className="model-grid">{ORGANIZATION_MODELS.map(([key, label, summary, icon]) => <label
      key={key} className={kind === key ? 'selected' : ''}><input type="radio"
        name="organizationKind" value={key} checked={kind === key} onChange={() => onChange(key)} />
      <WizardIcon name={icon} /><span><strong>{label}</strong><small>{summary}</small></span>
      <b aria-hidden="true">{kind === key ? '✓' : '+'}</b></label>)}</div>
  </fieldset>;
}

function IndustryProfile(props: DetailsProps) {
  return <section className="onboarding-step" data-wizard-step="0" aria-labelledby="industry-question">
    <div className="onboarding-question"><p className="onboarding-kicker">Business profile</p>
      <h2 id="industry-question" tabIndex={-1}>What kind of business are you building?</h2>
      <p>Choose a starting point now. Add the business and location details on the final step.</p></div>
    <fieldset className="industry-grid"><legend className="sr-only">Business industry</legend>
      {INDUSTRY_OPTIONS.map((option, index) => <label
        className={`industry-option${props.industry === option.key ? ' selected' : ''}`} key={option.key}>
        <input type="radio" name="industryKey" value={option.key} required
          checked={props.industry === option.key} autoFocus={index === 0}
          onChange={() => props.onIndustryChange(option.key)} />
        <span className="industry-visual"><WizardIcon name={INDUSTRY_ICONS[option.key]} /></span>
        <span className="industry-copy"><strong>{option.label}</strong><small>{option.summary}</small></span>
        <span className="industry-check" aria-hidden="true">✓</span>
      </label>)}
    </fieldset>
  </section>;
}

function OrganizationModel(props: DetailsProps) {
  return <section className="onboarding-step" data-wizard-step="1" aria-labelledby="model-question">
    <div className="onboarding-question"><p className="onboarding-kicker">Organization model</p>
      <h2 id="model-question" tabIndex={-1}>How is this organization governed?</h2>
      <p>This controls location ownership, network membership, and management boundaries.</p></div>
    <div className="onboarding-card-stack profile-card-stack">
      <ModelChoices kind={props.kind} onChange={props.onKindChange} />
    </div>
  </section>;
}

function IdentityCard(props: DetailsProps) {
  return <section className="onboarding-card identity-card"><header><span>01</span><div><strong>Business identity</strong>
    <p>The minimum needed to create the organization.</p></div></header>
    <div className="onboarding-fields identity-fields">
      <label>Organization name<input name="name" required maxLength={120} value={props.name}
        autoComplete="organization" placeholder="Your business name" aria-invalid={props.invalidField === 'name'}
        aria-errormessage={props.invalidField === 'name' ? 'organization-step-error' : undefined}
        onChange={(event) => props.onNameChange(event.target.value)} /></label>
      <label>Owner email<input name="ownerEmail" type="email" required maxLength={254}
        defaultValue={props.ownerEmail} autoComplete="email" placeholder="owner@business.com" /></label>
    </div>
  </section>;
}

function LocationCard({ invalidField }: { readonly invalidField: BusinessStepField | null }) {
  return <section className="onboarding-card location-card"><header><span>02</span><div><strong>First location</strong>
    <p>Start with one location. Add more at any time.</p></div></header>
    <div className="onboarding-fields location-fields">
      <label>Location name<input name="locationName" required maxLength={120} placeholder="Main location" /></label>
      <label>Street <span>(optional)</span><input name="street" maxLength={160} autoComplete="street-address" placeholder="100 Market Street" /></label>
      <label>City<input name="city" maxLength={120} autoComplete="address-level2" placeholder="Riverside" /></label>
      <label>State / region <span>(optional)</span><input name="region" maxLength={80} autoComplete="address-level1" placeholder="State or region" /></label>
      <label>Postal code <span>(optional)</span><input name="postal" maxLength={24} autoComplete="postal-code" placeholder="Postal code" /></label>
      <label>Timezone<select name="timezone" defaultValue="America/Denver" required>
        {TIMEZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
      <label>Opens<input name="openTime" type="time" required defaultValue="08:00" /></label>
      <label>Closes<input name="closeTime" type="time" required defaultValue="17:00"
        aria-invalid={invalidField === 'closeTime'} aria-errormessage={invalidField === 'closeTime' ? 'organization-step-error' : undefined} /></label>
      <fieldset className="onboarding-days" aria-invalid={invalidField === 'days'}
        aria-errormessage={invalidField === 'days' ? 'organization-step-error' : undefined}><legend>Open days</legend>
        {WEEKDAYS.map((day, index) => <label key={day}><input type="checkbox" name="days" value={day}
          defaultChecked={index < 5} /><span>{day.slice(0, 3)}</span></label>)}</fieldset>
    </div>
  </section>;
}

function FinalDetails(props: DetailsProps) {
  const needsLocation = props.kind === 'independent' || props.kind === 'franchisee';
  return <section className="onboarding-step" data-wizard-step="4" aria-labelledby="details-question">
    <div className="onboarding-question"><p className="onboarding-kicker">Final details</p>
      <h2 id="details-question" tabIndex={-1}>Add the business and first location</h2>
      <p>One concise form completes the tenant setup across all five applications.</p></div>
    <div className="onboarding-card-stack final-details-stack"><IdentityCard {...props} />
      {needsLocation ? <LocationCard invalidField={props.invalidField} /> : null}
      {props.kind === 'franchisee' ? <section className="onboarding-card network-card"><header><span>03</span>
        <div><strong>Franchise membership</strong><p>Link this location to its governing network.</p></div></header>
        <div className="onboarding-fields"><label>Network handle<input name="networkSlug" required maxLength={63}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="example-network" /></label>
          <label>Territory <span>(optional)</span><input name="territory" maxLength={500} placeholder="North district" /></label></div>
      </section> : null}
    </div>
  </section>;
}

export function OrganizationOnboardingDetails(props: DetailsProps) {
  if (props.mode === 'profile') return <IndustryProfile {...props} />;
  if (props.mode === 'model') return <OrganizationModel {...props} />;
  return <FinalDetails {...props} />;
}
