import type { ConnectorCard } from '@/lib/integration-cards';
import type { OrganizationReviewDetails } from '@/lib/organization-business-step';
import { INDUSTRY_OPTIONS, MODULE_OPTIONS } from '@/lib/organization-onboarding';
import type { IndustryKey, OrganizationKind } from '@/lib/org-input';

const APPS = [
  ['hq', 'HQ', 'Configure the organization and its locations.'],
  ['customer', 'Customer', 'A tenant-branded customer experience.'],
  ['operator', 'Operator', 'Live work, training, and team operations.'],
  ['kiosk', 'Kiosk / POS', 'On-site service and transactions.'],
  ['display', 'Display', 'A tenant-aware public activity surface.'],
] as const;

const KIND_LABELS: Readonly<Record<OrganizationKind, string>> = {
  independent: 'Independent business', franchisor: 'Franchise network',
  franchisee: 'Franchise location', operator: 'Management operator',
};

type ReviewProps = {
  readonly companyName: string;
  readonly industry: IndustryKey;
  readonly kind: OrganizationKind;
  readonly modules: readonly string[];
  readonly connectors: readonly string[];
  readonly connectorCards: readonly ConnectorCard[];
  readonly details: OrganizationReviewDetails;
};

export function OrganizationReviewStep(props: ReviewProps) {
  const industry = INDUSTRY_OPTIONS.find((option) => option.key === props.industry);
  const moduleNames = MODULE_OPTIONS.filter((module) => props.modules.includes(module.key))
    .map((module) => module.label);
  const connectorNames = props.connectorCards.filter((card) => props.connectors.includes(card.id))
    .map((card) => card.displayName);
  return (
    <section className="onboarding-step review-step" data-wizard-step="3" aria-labelledby="review-title">
      <div className="review-identity">
        <span aria-hidden="true">{props.companyName.trim().slice(0, 1).toUpperCase()}</span>
        <div><p className="onboarding-kicker">Ready to create</p>
          <h2 id="review-title" tabIndex={-1}>{props.companyName.trim()}</h2>
          <p>{industry?.label} · {KIND_LABELS[props.kind]}</p></div>
      </div>
      <div className="review-summary">
        <article><strong>{moduleNames.length}</strong><span>Modules</span>
          <p>{moduleNames.length ? moduleNames.join(', ') : 'Base applications only'}</p></article>
        <article><strong>{connectorNames.length}</strong><span>MCP tools</span>
          <p>{connectorNames.length ? connectorNames.join(', ') : 'Connect later from the MCP Store'}</p></article>
        <article><strong>5</strong><span>Applications</span>
          <p>One tenant configuration, isolated across every surface.</p></article>
      </div>
      <dl className="review-details"><div><dt>Owner</dt><dd>{props.details.ownerEmail}</dd></div>
        <div><dt>Location</dt><dd>{props.details.location || 'Added after network setup'}</dd></div>
        {props.details.hours ? <div><dt>Hours</dt><dd>{props.details.hours}</dd></div> : null}
        {props.details.network ? <div><dt>Network</dt><dd>{props.details.network}</dd></div> : null}
        {props.details.territory ? <div><dt>Territory</dt><dd>{props.details.territory}</dd></div> : null}</dl>
      <div className="review-app-heading"><div><p className="onboarding-kicker">Application set</p>
        <h3>Five apps, one organization</h3></div><span>Provisioned together</span></div>
      <div className="review-apps">{APPS.map(([key, label, summary], index) => <article key={key}>
        <span>{String(index + 1).padStart(2, '0')}</span><div><strong>{label}</strong><p>{summary}</p></div>
      </article>)}</div>
    </section>
  );
}
