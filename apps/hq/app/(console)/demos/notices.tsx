type Params = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function count(value: string | string[] | undefined): number {
  const number = Number(first(value));
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

const ERRORS: Readonly<Record<string, string>> = {
  forbidden: 'Only platform administrators can run the demo factory.',
  rate_limited: 'Too many changes in a minute. Wait a moment and try again.',
  unconfigured: 'This deployment has no database connection, so nothing was saved.',
  not_ready: 'The factory stays off until a Google Places key, DEMO_LINK_SECRET, DEMO_BUILDER_NAME and '
    + 'DEMO_ORIGINALITY_DENYLIST are configured.',
  places_unconfigured: 'No Google Places key is configured, so the search could not run. Nothing was billed.',
  places_quota: 'Google says the Places quota is used up for now. Nothing was queued.',
  places_error: 'The Google search failed. Nothing was queued; try again shortly.',
  database: 'The change could not be saved. Nothing was billed.',
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What the last action did, in a sentence, from the redirect it answered with. */
export function DemoNotices({ params }: { params: Params }) {
  const error = first(params.error);
  if (error) {
    const message = error === 'invalid' ? first(params.detail) || 'Check the form and try again.' : ERRORS[error];
    return message ? <div className="notice factory-notice-danger" role="alert">{message}</div> : null;
  }
  if (first(params.found) !== undefined) {
    const found = count(params.found);
    const queued = count(params.queued);
    return (
      <div className="notice" role="status">
        The search found {plural(found, 'business', 'businesses')}; {queued} will be built.
        {found > queued ? ' The rest already have a demo, are being built by another batch, or asked to be left alone.' : ''}
      </div>
    );
  }
  if (first(params.stopped) !== undefined) {
    return (
      <div className="notice" role="status">
        Batch stopped. {plural(count(params.stopped), 'business that had not started was', 'businesses that had not started were')} skipped.
      </div>
    );
  }
  const switched = first(params.switched);
  if (switched === 'on') return <div className="notice" role="status">The factory is on. Queued businesses are built at the next scheduled run.</div>;
  if (switched === 'off') return <div className="notice" role="status">The factory is off. Demos already being built will finish; nothing new starts.</div>;
  if (first(params.saved)) return <div className="notice" role="status">Daily limits saved.</div>;
  return null;
}
