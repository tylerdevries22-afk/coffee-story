'use client';

import styles from './styles.module.css';

export type McpStoreSetupKind = 'one-click-oauth' | 'api-key' | 'operator-portal';

export type McpStoreSetupStep = {
  readonly text: string;
  readonly href?: string;
};

export type McpStoreSetup = {
  readonly kind: McpStoreSetupKind;
  readonly estimatedMinutes: number;
  readonly steps: readonly McpStoreSetupStep[];
  readonly consoleHref?: string | null;
  readonly consoleLabel?: string;
  readonly documentationHref?: string | null;
};

const KIND_LABELS: Readonly<Record<McpStoreSetupKind, string>> = {
  'one-click-oauth': 'One-click sign-in',
  'api-key': 'Paste an API key',
  'operator-portal': 'Guided import',
};

export function setupKindLabel(kind: McpStoreSetupKind): string {
  return KIND_LABELS[kind];
}

/** Renders the effort promise a reader checks before committing to setup. */
export function SetupBadge({ setup }: { readonly setup: McpStoreSetup }) {
  const minutes = setup.estimatedMinutes;
  return <span className={styles.setupBadge} data-kind={setup.kind}>
    {setupKindLabel(setup.kind)}
    {minutes > 0 ? <small>{minutes === 1 ? '~1 min' : `~${minutes} min`}</small> : null}
  </span>;
}

function StepText({ step }: { readonly step: McpStoreSetupStep }) {
  if (!step.href) return <>{step.text}</>;
  const external = step.href.startsWith('https://');
  return <a href={step.href} {...(external ? { rel: 'noreferrer noopener', target: '_blank' } : {})}>
    {step.text}
  </a>;
}

/**
 * The walked setup path. Collapsed by default so the directory stays scannable,
 * and never rendered when a host supplied no steps.
 */
export function SetupDisclosure({ entry, setup }: {
  readonly entry: Readonly<{ id: string; name: string }>;
  readonly setup: McpStoreSetup;
}) {
  if (setup.steps.length === 0) return null;
  return <details className={styles.setup}>
    <summary aria-label={`How to connect ${entry.name}`}>
      How to connect<SetupBadge setup={setup} />
    </summary>
    <ol>{setup.steps.map((step, index) => <li key={`${entry.id}-step-${index}`}>
      <StepText step={step} />
    </li>)}</ol>
    <p className={styles.setupLinks}>
      {setup.consoleHref ? <a href={setup.consoleHref} rel="noreferrer noopener" target="_blank">
        {setup.consoleLabel ?? 'Open provider console'}
      </a> : null}
      {setup.documentationHref ? <a href={setup.documentationHref} rel="noreferrer noopener" target="_blank">
        Provider documentation
      </a> : null}
    </p>
  </details>;
}
