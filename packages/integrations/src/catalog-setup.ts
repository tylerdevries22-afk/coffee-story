import type { ConnectorSetup } from './contracts';

/**
 * Said at the end of any walkthrough whose last mile is not built yet.
 *
 * The MCP Store row renders the step list with no other commentary, so a
 * walkthrough that stops at "paste it here" would send an owner looking for a
 * field that does not exist. The detail page repeats this in its own words.
 */
const PENDING_STORAGE =
  'Keep the key somewhere safe for now: storing it against this organization is not enabled yet, so setup cannot be finished today.';
const PENDING_IMPORT =
  'Keep the export somewhere safe for now: uploading it is not enabled yet, so the import cannot be finished today.';

/**
 * Builds the one-press OAuth setup block shared by every hosted-client provider.
 *
 * `redirectPath` must be passed explicitly and only when a route actually serves
 * it. Deriving it from the connector id would publish a callback URL that 404s
 * for any provider without a `/api/connectors/<id>/callback` handler, and would
 * override the real callback for a provider that serves one elsewhere.
 */
export function oauthSetup(
  input: Readonly<{
    consoleUrl: string;
    documentationUrl: string;
    operatorSteps: readonly ConnectorSetup['steps'][number][];
    estimatedMinutes?: number;
    redirectPath?: string;
    /** Set when no adapter is wired yet, so the steps promise nothing false. */
    awaitingRuntime?: boolean;
  }>,
): ConnectorSetup {
  const opening = input.awaitingRuntime
    ? 'Adapter certification is pending, so Connect activates once this provider is certified.'
    : 'Press Connect and approve the requested scopes.';
  return Object.freeze({
    kind: 'one-click-oauth' as const,
    estimatedMinutes: input.estimatedMinutes ?? 1,
    consoleUrl: input.consoleUrl,
    documentationUrl: input.documentationUrl,
    ...(input.redirectPath === undefined ? {} : { redirectPath: input.redirectPath }),
    steps: Object.freeze([
      Object.freeze({ text: opening }),
      ...input.operatorSteps.map((step) => Object.freeze({ ...step })),
    ]),
  });
}

/** The callback path served by the shared connector OAuth route. */
export function connectorCallbackPath(id: string): string {
  return `/api/connectors/${id}/callback`;
}

/** Builds a copy-a-key setup block for providers that issue no OAuth client to us. */
/**
 * Builds a copy-a-key setup block for providers that issue no OAuth client to us.
 *
 * The key belongs to one organization and is stored against its
 * `credential_references` row in Vault, so there is nothing for an operator to
 * put in the environment.
 *
 * The trailing step is not optional. The store row shows these steps with no
 * other commentary, so without it the guidance would tell an owner to paste a key
 * that no route yet accepts, and the row would offer nowhere to paste it.
 */
export function apiKeySetup(
  input: Readonly<{
    consoleUrl: string;
    documentationUrl: string;
    steps: readonly ConnectorSetup['steps'][number][];
    estimatedMinutes?: number;
  }>,
): ConnectorSetup {
  return Object.freeze({
    kind: 'api-key' as const,
    estimatedMinutes: input.estimatedMinutes ?? 3,
    consoleUrl: input.consoleUrl,
    documentationUrl: input.documentationUrl,
    steps: Object.freeze([
      ...input.steps.map((step) => Object.freeze({ ...step })),
      Object.freeze({ text: PENDING_STORAGE }),
    ]),
  });
}

/** Builds a guided manual block for providers that publish no API at all. */
export function portalSetup(
  input: Readonly<{
    consoleUrl?: string;
    documentationUrl?: string;
    steps: readonly ConnectorSetup['steps'][number][];
    estimatedMinutes?: number;
  }>,
): ConnectorSetup {
  // An entry with no steps is a roadmap placeholder, so it gets no note either.
  const steps = input.steps.map((step) => Object.freeze({ ...step }));
  return Object.freeze({
    kind: 'operator-portal' as const,
    estimatedMinutes: input.estimatedMinutes ?? 5,
    ...(input.consoleUrl === undefined ? {} : { consoleUrl: input.consoleUrl }),
    ...(input.documentationUrl === undefined ? {} : { documentationUrl: input.documentationUrl }),
    steps: Object.freeze(
      steps.length > 0 ? [...steps, Object.freeze({ text: PENDING_IMPORT })] : steps,
    ),
  });
}
