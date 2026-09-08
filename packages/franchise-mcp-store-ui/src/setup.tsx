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

/**
 * A step link is host copy, so the scheme is enforced here rather than trusted:
 * only an https URL or a same-app absolute path renders as a link, and anything
 * else degrades to plain text. That keeps `javascript:` and `data:` unreachable
 * even if a host passes one.
 */
function safeHref(href: string): { readonly href: string; readonly external: boolean } | null {
  if (href.startsWith('https://')) return { href, external: true };
  if (href.startsWith('/') && !href.startsWith('//')) return { href, external: false };
  return null;
}

function StepText({ step }: { readonly step: McpStoreSetupStep }) {
  const target = step.href ? safeHref(step.href) : null;
  if (!target) return <>{step.text}</>;
  return <a href={target.href}
    {...(target.external ? { rel: 'noreferrer noopener', target: '_blank' } : {})}>
    {step.text}
  </a>;
}

function SetupLink({ href, text }: {
  readonly href: string | null | undefined;
  readonly text: string;
}) {
  const target = href ? safeHref(href) : null;
  if (!target) return null;
  return <a href={target.href}
    {...(target.external ? { rel: 'noreferrer noopener', target: '_blank' } : {})}>{text}</a>;
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
      <SetupLink href={setup.consoleHref} text={setup.consoleLabel ?? 'Open provider console'} />
      <SetupLink href={setup.documentationHref} text="Provider documentation" />
    </p>
  </details>;
}
