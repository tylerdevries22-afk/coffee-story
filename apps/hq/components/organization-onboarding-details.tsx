'use client';

import type { BusinessStepField } from '@/lib/organization-business-step';
import type { OrganizationKind } from '@/lib/org-input';
import { MANUAL_PREFILL, type PlacePrefill, type PrefillField } from '@/lib/place-prefill';

import { FieldLabel, invalidProps } from './field-label';
import { OrganizationLocationCard } from './organization-location-card';
import { WizardIcon, type WizardIconName } from './wizard-icon';

const ORGANIZATION_MODELS: readonly [OrganizationKind, string, string, WizardIconName][] = [
  ['independent', 'Independent', 'One business with its own locations.', 'independent'],
  ['franchisor', 'Franchise network', 'A brand that governs many organizations.', 'franchise'],
  ['franchisee', 'Franchise location', 'A business joining an existing network.', 'location'],
  ['operator', 'Management operator', 'A team operating locations for other owners.', 'operations'],
];

type DetailsProps = {
  readonly mode: 'model' | 'details';
  readonly name: string;
  readonly kind: OrganizationKind;
  readonly ownerEmail: string;
  /** Where the details came from; null until step 0 settles it. */
  readonly prefill: PlacePrefill | null;
  readonly onKindChange: (kind: OrganizationKind) => void;
  readonly onNameChange: (name: string) => void;
  readonly onEdited: (field: PrefillField) => void;
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

function IdentityCard(props: DetailsProps & { readonly prefill: PlacePrefill }) {
  const google = (field: PrefillField) => props.prefill.fromGoogle.has(field);
  return <section className="onboarding-card identity-card"><header><span>01</span><div><strong>Business identity</strong>
    <p>The minimum needed to create the organization.</p></div></header>
    <div className="onboarding-fields identity-fields">
      <FieldLabel label="Organization name" className="wide" fromGoogle={google('name')}>
        <input name="name" required maxLength={120} value={props.name} autoComplete="organization"
          placeholder="Your business name" {...invalidProps('name', props.invalidField)}
          onChange={(event) => props.onNameChange(event.target.value)} /></FieldLabel>
      <label>Owner email<input name="ownerEmail" type="email" required maxLength={254}
        defaultValue={props.ownerEmail} autoComplete="email" placeholder="owner@business.com" /></label>
      {/* The factory's research starts from this site, so it is asked of every organization. */}
      <FieldLabel label="Website" optional fromGoogle={google('website')}>
        <input key={props.prefill.key} name="website" type="url" maxLength={2048} autoComplete="url"
          placeholder="https://business.com" defaultValue={props.prefill.draft?.website ?? ''}
          onChange={() => props.onEdited('website')} {...invalidProps('website', props.invalidField)} /></FieldLabel>
    </div>
  </section>;
}

function FinalDetails(props: DetailsProps) {
  const needsLocation = props.kind === 'independent' || props.kind === 'franchisee';
  const prefill = props.prefill ?? MANUAL_PREFILL;
  const reviewing = prefill.draft !== null;
  return <section className="onboarding-step" data-wizard-step="4" aria-labelledby="details-question">
    <div className="onboarding-question"><p className="onboarding-kicker">Final details</p>
      <h2 id="details-question" tabIndex={-1}>{reviewing ? 'Review the business and first location' : 'Add the business and first location'}</h2>
      <p>{reviewing
        ? 'Fields marked From Google hold the listing’s values until you change them. Check each one before you create the organization.'
        : 'One concise form completes the tenant setup across all five applications.'}</p></div>
    <div className="onboarding-card-stack final-details-stack"><IdentityCard {...props} prefill={prefill} />
      {needsLocation ? <OrganizationLocationCard key={prefill.key} prefill={prefill}
        invalidField={props.invalidField} onEdited={props.onEdited} /> : null}
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
  if (props.mode === 'model') return <OrganizationModel {...props} />;
  return <FinalDetails {...props} />;
}
