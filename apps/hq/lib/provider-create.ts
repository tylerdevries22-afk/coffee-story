/**
 * Retrying a provider create without duplicating what it made.
 *
 * The factory provisions a GitHub repository, a Doppler project, a Supabase
 * project and the declared Vercel projects, each with one POST. None of those providers
 * accepts an Idempotency-Key header, so the workflow gives a POST a single
 * attempt: a blind retry risks two repositories or two billed Supabase
 * projects, which is worse than the failure it would paper over. The price of
 * that choice is that one transient 502 fails a run which has already
 * provisioned half a tenant.
 *
 * The lookup every caller already performs before creating is the idempotency
 * key these providers do not offer. Asking it again after a failed create
 * separates the two cases that matter: the write landed and only the response
 * was lost, so adopt what is there; or it never landed, so making it now
 * cannot duplicate anything.
 */

/** Bounded, so a provider that is genuinely refusing fails the run rather than looping on it. */
const CREATE_ATTEMPTS = 3;
const BACKOFF_MS = 1_000;

export type CreateOrAdoptDependencies = Readonly<{
  onEvent?: (event: string, metadata: Record<string, unknown>) => void;
  delay?: (milliseconds: number) => Promise<void>;
}>;

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

/**
 * Create a provider resource, adopting one a failed attempt may have already made.
 *
 * `lookup` resolves to the existing resource or null. It is only consulted
 * after a create fails, so the happy path costs exactly what it did before.
 */
export async function createOrAdopt<T>(
  label: string,
  create: () => Promise<T>,
  lookup: () => Promise<T | null>,
  dependencies: CreateOrAdoptDependencies = {},
): Promise<T> {
  const delay = dependencies.delay ?? pause;
  let failure: Error | null = null;

  for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      // A lookup that throws is not evidence of absence, so it ends the run
      // here. Treating "we could not tell" as "it is not there" is exactly how
      // a second repository gets created.
      const existing = await lookup();
      if (existing !== null) {
        dependencies.onEvent?.('provider.create_adopted', { label, attempt });
        return existing;
      }
    }

    try {
      return await create();
    } catch (error) {
      failure = error instanceof Error ? error : new Error(`${label} could not be created.`);
      dependencies.onEvent?.('provider.create_retry', { label, attempt, reason: failure.message });
      if (attempt < CREATE_ATTEMPTS) await delay(attempt * BACKOFF_MS);
    }
  }

  throw failure ?? new Error(`${label} could not be created.`);
}
