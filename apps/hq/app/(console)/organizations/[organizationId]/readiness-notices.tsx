const NOTICES: Record<string, string> = {
  complete: 'Organization activated. Its production surfaces may now serve tenant traffic.',
  'not-ready': 'Activation is blocked until every required readiness check passes.',
  failed: 'Activation was refused. Review the readiness evidence and try again.',
  unavailable: 'Supabase is not configured for activation on this deployment.',
};
const GOLIVE_NOTICES: Record<string, { message: string; failed: boolean }> = {
  started: {
    message: 'Go live started. Production hosts {slug}-hq and {slug}-display will mint now.',
    failed: false,
  },
  'already-live': { message: 'This shop is already live.', failed: false },
  'no-run': { message: 'No factory run found for this shop. Resume onboarding first.', failed: true },
  forbidden: { message: 'Only the owner or a platform admin can tap Go live.', failed: true },
  failed: { message: 'Go live could not start. Check factory credentials and try again.', failed: true },
  unavailable: { message: 'Supabase is not configured for Go live on this deployment.', failed: true },
};

const LIFECYCLE_NOTICES: Record<string, { message: string; failed: boolean }> = {
  suspended: { message: 'Organization suspended. Devices and delegated grants were revoked.', failed: false },
  restored: { message: 'Organization restored. Re-pair devices before they can serve again.', failed: false },
  offboarded: { message: 'Organization offboarded. Access is terminal; data remains for audit.', failed: false },
  failed: { message: 'Lifecycle change was refused. Confirm platform admin access and try again.', failed: true },
  unavailable: { message: 'Supabase is not configured for lifecycle actions on this deployment.', failed: true },
};

type Query = {
  activation?: string;
  factory?: string;
  golive?: string;
  lifecycle?: string;
};

export function ReadinessNotices({ query, slug }: { query: Query; slug: string }) {
  const goliveNotice = query.golive ? GOLIVE_NOTICES[query.golive] : undefined;
  const lifecycleNotice = query.lifecycle ? LIFECYCLE_NOTICES[query.lifecycle] : undefined;
  return (
    <>
      {query.activation && NOTICES[query.activation] ? (
        <div className={query.activation === 'complete' ? 'notice' : 'notice danger'} role="status">
          {NOTICES[query.activation]}
        </div>
      ) : null}
      {query.factory === 'failed' ? (
        <div className="notice danger" role="status">
          The organization was provisioned, but factory automation did not start. Resume it from Onboarding.
        </div>
      ) : null}
      {goliveNotice ? (
        <div className={goliveNotice.failed ? 'notice danger' : 'notice'} role="status">
          {goliveNotice.message.replaceAll('{slug}', slug)}
        </div>
      ) : null}
      {lifecycleNotice ? (
        <div className={lifecycleNotice.failed ? 'notice danger' : 'notice'} role="status">
          {lifecycleNotice.message}
        </div>
      ) : null}
    </>
  );
}
