import { setupKindLabel } from 'franchise-mcp-store-ui';

import type { ConnectorCard } from '@/lib/integration-cards';

const KIND_HEADLINES: Readonly<Record<ConnectorCard['setup']['kind'], string>> = {
  'one-click-oauth': 'Connect in one press',
  'api-key': 'Copy one key across',
  'operator-portal': 'Import the provider export',
};

const KIND_NOTES: Readonly<Record<ConnectorCard['setup']['kind'], string>> = {
  'one-click-oauth':
    'This deployment already holds the provider client, so you approve scopes and nothing else. Tokens are stored as Vault references and never reach this browser.',
  'api-key':
    'This provider issues no OAuth client to us, so one key is copied from the screen linked below. The key is written straight to Vault and is never displayed again.',
  'operator-portal':
    'This provider publishes no API. Download the report it does offer and upload it here; column mapping is automatic and every import is reversible.',
};

function StepLink({ href, text }: { readonly href: string; readonly text: string }) {
  const external = href.startsWith('https://');
  return <a href={href} {...(external ? { rel: 'noreferrer noopener', target: '_blank' } : {})}>{text}</a>;
}

/** The full walked setup path for one provider, shown on its detail page. */
export function ConnectorSetupPanel({ card }: { readonly card: ConnectorCard }) {
  const { setup } = card;
  return (
    <section className="card connector-setup-panel">
      <p className="eyebrow">
        {setupKindLabel(setup.kind)}
        {setup.estimatedMinutes > 0 ? ` · about ${setup.estimatedMinutes} min` : ''}
      </p>
      <h2>{KIND_HEADLINES[setup.kind]}</h2>
      <p>{KIND_NOTES[setup.kind]}</p>
      <ol className="connector-setup-steps">
        {setup.steps.map((step, index) => (
          <li key={`${card.id}-step-${index}`}>
            {step.href ? <StepLink href={step.href} text={step.text} /> : step.text}
          </li>
        ))}
      </ol>
      <p className="connector-setup-links">
        <StepLink href={setup.consoleUrl} text="Open provider console" />
        <StepLink href={setup.documentationUrl} text="Provider documentation" />
      </p>
      {setup.redirectPath ? (
        <p className="connector-setup-redirect">
          <span>Redirect URI to register with the provider</span>
          <code>{setup.redirectPath}</code>
        </p>
      ) : null}
      {setup.credentialEnvKeys.length > 0 ? (
        <p className="connector-setup-env">
          <span>Deployment secrets this connector reads</span>
          <code>{setup.credentialEnvKeys.join(', ')}</code>
        </p>
      ) : null}
    </section>
  );
}
