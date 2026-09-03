/**
 * The per-tenant status page's view model: probe outcomes in, dependency rows
 * and incidents out.
 *
 * Free of Supabase, `headers()` and JSX so `node:test` can reach every state.
 * The states worth testing on a status page are the failing ones, and those
 * are exactly the ones nobody can reproduce by loading the page.
 *
 * Nothing here carries tenant data beyond the display name the loader already
 * resolved. Fee terms, brand config, credentials and other tenants' rows never
 * enter this module, so they cannot leave it.
 */

export type DependencyKey = 'ordering' | 'order-updates' | 'platform-api';

/** What one probe saw. Deliberately not booleans: "did not ask" is its own answer. */
export type ProbeOutcome =
  /** The dependency answered the way it is supposed to. */
  | 'answered'
  /** It answered, but said it is not well. */
  | 'impaired'
  /** It refused, timed out, or could not be reached. */
  | 'failed'
  /** This deployment has nothing to ask -- a preview build with no database. */
  | 'unavailable';

export type DependencyState = 'operational' | 'degraded' | 'outage' | 'unknown';

export type DependencyReport = Readonly<{
  key: DependencyKey;
  name: string;
  detail: string;
  state: DependencyState;
  note: string;
}>;

export type StatusIncident = Readonly<{
  key: DependencyKey;
  title: string;
  impact: string;
  observedAt: string;
}>;

type Dependency = Readonly<{
  key: DependencyKey;
  name: string;
  /** What a guest or a barista would notice, in their words, not ours. */
  detail: string;
  /** What breaks while this dependency is down. */
  impact: string;
}>;

/**
 * Three dependencies because there are three, not because three reads nicely.
 * Each maps to a distinct boundary: the storefront read every app makes before
 * anyone can order, the board projection the tracker and pickup screens
 * follow, and the API process itself.
 */
const DEPENDENCIES: readonly Dependency[] = [
  {
    key: 'ordering',
    name: 'Ordering',
    detail: 'Opening the menu, placing and paying for an order',
    impact: 'Guests cannot open the menu or start an order.',
  },
  {
    key: 'order-updates',
    name: 'Order updates',
    detail: 'Live status on the pickup board and the guest tracker',
    impact: 'Orders still reach the counter, but the board and tracker stop moving.',
  },
  {
    key: 'platform-api',
    name: 'Platform API',
    detail: 'The service the apps and devices call',
    impact: 'Apps and staff devices cannot reach the platform.',
  },
];

const STATE_BY_OUTCOME: Readonly<Record<ProbeOutcome, DependencyState>> = {
  answered: 'operational',
  impaired: 'degraded',
  failed: 'outage',
  unavailable: 'unknown',
};

const NOTE_BY_STATE: Readonly<Record<DependencyState, string>> = {
  operational: 'Answering normally.',
  degraded: 'Answering, but reporting a problem.',
  outage: 'Not answering.',
  // An honest "we did not look" beats a green tick nobody earned. The stub
  // this page replaced claimed nothing either; it just did not say so.
  unknown: 'Not checked on this deployment.',
};

const STATE_LABELS: Readonly<Record<DependencyState, string>> = {
  operational: 'Operational',
  degraded: 'Degraded',
  outage: 'Outage',
  unknown: 'Unknown',
};

/** The `pill` modifier for a state; unknown takes the plain pill. */
const STATE_TONES: Readonly<Record<DependencyState, string>> = {
  operational: 'success',
  degraded: 'warning',
  outage: 'danger',
  unknown: '',
};

/** Worst first: one outage outranks two operational dependencies. */
const SEVERITY: readonly DependencyState[] = ['outage', 'degraded', 'unknown', 'operational'];

export function stateLabel(state: DependencyState): string {
  return STATE_LABELS[state];
}

export function stateTone(state: DependencyState): string {
  return STATE_TONES[state];
}

/** Resolves every declared dependency, in a fixed order, from what was probed. */
export function dependencyReports(
  outcomes: Readonly<Partial<Record<DependencyKey, ProbeOutcome>>>,
): readonly DependencyReport[] {
  return DEPENDENCIES.map((dependency) => {
    const state = STATE_BY_OUTCOME[outcomes[dependency.key] ?? 'unavailable'];
    return Object.freeze({
      key: dependency.key,
      name: dependency.name,
      detail: dependency.detail,
      state,
      note: NOTE_BY_STATE[state],
    });
  });
}

/**
 * The headline. Reports the worst dependency rather than an average, because
 * a page that says "mostly fine" while ordering is down is worse than no page.
 */
export function overallState(reports: readonly DependencyReport[]): DependencyState {
  if (reports.length === 0) return 'unknown';
  return SEVERITY.find((state) => reports.some((report) => report.state === state)) ?? 'unknown';
}

export function overallSummary(state: DependencyState): string {
  if (state === 'operational') return 'All checked dependencies are answering normally.';
  if (state === 'degraded') return 'A dependency is answering but reporting a problem.';
  if (state === 'outage') return 'A dependency is not answering. Some ordering may be affected.';
  return 'No dependency checks ran for this deployment.';
}

/**
 * Incidents observed at this instant, derived from the probes themselves.
 *
 * There is no incident table to read and no operator-written history to show;
 * inventing one would be the same dishonesty as a permanent green tick. A
 * failing dependency is reported as the incident it is, with the impact spelled
 * out, and the observation time so a reader knows how fresh the claim is.
 */
export function statusIncidents(
  reports: readonly DependencyReport[],
  observedAt: string,
): readonly StatusIncident[] {
  const impacts = new Map(DEPENDENCIES.map((dependency) => [dependency.key, dependency.impact]));
  return reports
    .filter((report) => report.state === 'outage' || report.state === 'degraded')
    .map((report) => Object.freeze({
      key: report.key,
      title: report.state === 'outage'
        ? `${report.name} is not answering`
        : `${report.name} is degraded`,
      impact: impacts.get(report.key) ?? '',
      observedAt,
    }));
}
