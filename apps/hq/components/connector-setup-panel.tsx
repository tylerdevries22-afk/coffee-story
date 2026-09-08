import { SetupBadge, type McpStoreSetup } from 'franchise-mcp-store-ui';

import { sharedSetup } from '@/lib/mcp-store-projection';
import type { ConnectorCard } from '@/lib/integration-cards';

const KIND_HEADLINES: Readonly<Record<ConnectorCard['setup']['kind'], string>> = {
  'one-click-oauth': 'Connect in one press',
  'api-key': 'Copy one key across',
  'operator-portal': 'Import the provider export',
};

const KIND_NOTES: Readonly<Record<ConnectorCard['setup']['kind'], string>> = {
  'one-click-oauth':
    'This deployment holds the provider client, so you approve scopes and nothing else. Tokens are stored as Vault references and never reach this browser.',
  'api-key':
    'This provider issues no OAuth client to us, so one key is copied from the screen linked below. The key is stored in Vault against this organization alone.',
  'operator-portal':
    'This provider publishes no API. Download the report it does offer and bring it here; nothing is stored until you do.',
};

type ConnectorSetupPanelProps = {
  readonly card: ConnectorCard;
  /** Deployment secret names, passed only for a reader entitled to see them. */
  readonly credentialEnvKeys?: readonly string[];
};

function SetupLink({ href, text }: { readonly href: string; readonly text: string }) {
  const external = href.startsWith('https://');
  return <a href={href} {...(external ? { rel: 'noreferrer noopener', target: '_blank' } : {})}>{text}</a>;
}

/** The full walked setup path for one provider, shown on its detail page. */
export function ConnectorSetupPanel({ card, credentialEnvKeys = [] }: ConnectorSetupPanelProps) {
  const setup: McpStoreSetup | undefined = sharedSetup(card);
  if (!setup) return null;
  const showOperatorDetail = credentialEnvKeys.length > 0;
  return (
    <section className="card connector-setup-panel">
      <p className="eyebrow"><SetupBadge setup={setup} /></p>
      <h2>{KIND_HEADLINES[setup.kind]}</h2>
      <p>{KIND_NOTES[setup.kind]}</p>
      <ol className="connector-setup-steps">
        {setup.steps.map((step, index) => (
          <li key={`${card.id}-step-${index}`}>
            {step.href ? <SetupLink href={step.href} text={step.text} /> : step.text}
          </li>
        ))}
      </ol>
      <p className="connector-setup-links">
        {setup.consoleHref
          ? <SetupLink href={setup.consoleHref} text={setup.consoleLabel ?? 'Open provider console'} /> : null}
        {setup.documentationHref
          ? <SetupLink href={setup.documentationHref} text="Provider documentation" /> : null}
      </p>
      {showOperatorDetail && card.setup.redirectPath ? (
        <p className="connector-setup-redirect">
          <span>Redirect URI to register with the provider</span>
          <code>{card.setup.redirectPath}</code>
        </p>
      ) : null}
      {showOperatorDetail ? (
        <p className="connector-setup-env">
          <span>Deployment secrets an operator sets for this connector</span>
          <code>{credentialEnvKeys.join(', ')}</code>
        </p>
      ) : null}
    </section>
  );
}
