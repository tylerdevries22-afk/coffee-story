/**
 * Explicit Go live gates and the human four-step loader contract.
 *
 * Product locks: Go live is never automatic. Factory completion must not mint
 * production hosts or flip Square live. Until Go live the shop stays on preview
 * Supabase + SQUARE_ENV=sandbox + factory canary. Owner or platform_admin taps
 * Go live to mint {slug}-hq and {slug}-display only.
 */

export const LOADER_STEPS = [
  'Business saved',
  'Database',
  'Apps',
  'Ready',
] as const;

export type LoaderStepLabel = (typeof LOADER_STEPS)[number];
export type LoaderStepIndex = 0 | 1 | 2 | 3;

export type FactoryLoaderInput = {
  readonly state: string;
  readonly stage: string;
  readonly businessName?: string;
  readonly completedTaskKeys?: ReadonlySet<string> | readonly string[];
  readonly blockedErrorCode?: string | null;
};

export type LoaderProgress = {
  readonly steps: typeof LOADER_STEPS;
  readonly activeIndex: LoaderStepIndex;
  readonly shopName: string;
  readonly awaitingGoLive: boolean;
};

function completedSet(
  value: FactoryLoaderInput['completedTaskKeys'],
): ReadonlySet<string> {
  if (!value) return new Set();
  return value instanceof Set ? value : new Set(value);
}

/** Production Vercel hosts mint only after an explicit Go live approval. */
export function mayMintProductionHosts(goLiveApproved: boolean): boolean {
  return goLiveApproved === true;
}

/**
 * Auto factory / completed canary must never flip Square to production or mint
 * live hosts. Only an explicit Go live approval may proceed.
 */
export function mayPromoteLive(goLiveApproved: boolean): boolean {
  return goLiveApproved === true;
}

/** Runtime Square environment until / at Go live. */
export function squareEnvForPhase(goLiveApproved: boolean): 'sandbox' | 'production' {
  return goLiveApproved ? 'production' : 'sandbox';
}

/**
 * Prefer the preview Supabase project for pre-go-live control-plane work.
 * Returns null when unset so callers fail closed rather than guessing prod.
 */
export function previewSupabaseProjectRef(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string | null {
  const value = env.SUPABASE_PREVIEW_PROJECT_REF?.trim();
  return value || null;
}

/**
 * Map factory run state onto the human loader steps:
 * Business saved → Database → Apps → Ready.
 */
export function loaderProgressFromFactoryRun(input: FactoryLoaderInput): LoaderProgress {
  const completed = completedSet(input.completedTaskKeys);
  const shopName = (input.businessName ?? '').trim() || 'Your shop';
  const awaitingGoLive = input.blockedErrorCode === 'go_live_required'
    || (
      input.state === 'blocked'
      && (input.stage === 'canary' || input.stage === 'live')
      && completed.has('verify-canary')
      && !completed.has('promote-live')
    );

  let activeIndex: LoaderStepIndex;
  if (input.state === 'live' || completed.has('promote-live')) {
    activeIndex = 3;
  } else if (
    awaitingGoLive
    || completed.has('verify-canary')
    || completed.has('publish-content')
    || completed.has('create-vercel-projects')
    || input.stage === 'content'
    || input.stage === 'canary'
  ) {
    activeIndex = 2;
  } else if (
    completed.has('create-supabase-project')
    || completed.has('create-doppler-project')
    || completed.has('create-github-repository')
    || completed.has('collect-credentials')
    || completed.has('verify-demo')
    || input.stage === 'infrastructure'
    || input.stage === 'credentials'
    || input.stage === 'demo'
  ) {
    activeIndex = 1;
  } else {
    activeIndex = 0;
  }

  return {
    steps: LOADER_STEPS,
    activeIndex,
    shopName,
    awaitingGoLive,
  };
}

/** Guard used by factory automation: completed runs still must not mint hosts. */
export function factoryCompletionMintsHosts(
  factoryRunCompleted: boolean,
  goLiveApproved: boolean,
): boolean {
  if (!factoryRunCompleted) return false;
  return mayMintProductionHosts(goLiveApproved);
}
