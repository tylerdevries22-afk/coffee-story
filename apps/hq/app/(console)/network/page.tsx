import { currentSession, hasRole } from '@/lib/auth';
import { loadIssuedGrants } from '@/lib/delegated-grants';
import { formatMoney } from '@/lib/kpi';
import { loadNetworkReports, networkTotals } from '@/lib/network-reporting';

import { revokeDelegatedAccessAction } from './actions';
import { PendingEnrollmentReview } from './pending-enrollment-review';

// The console is live data behind a session: never prerender a fixture
// snapshot at build time and serve it as if it were today's numbers.
export const dynamic = 'force-dynamic';

/**
 * Network reporting for franchisors and their time-boxed delegates.
 *
 * There is no role gate on this page on purpose. Every other console report
 * asks `hasRole` first because its subject is the signed-in user's own brand;
 * this one's subject is a network, and network standing lives in
 * franchise_memberships and delegated_access_grants rather than in the token.
 * `public.caller_network_brand_kpis` reads auth.uid() and refuses anyone
 * holding neither, so a reader with no network simply sees the empty state --
 * the boundary is the database's, under the reader's own session, with no
 * service-role key anywhere in the path.
 */
/**
 * The grants this brand has lent out, each with the control that ends it.
 *
 * Rendered only for a brand owner, because that is who
 * `public.revoke_delegated_access` admits alongside a platform administrator.
 * Until 20260904010000 nothing could write `revoked_at` early at all -- the
 * retention sweep only back-dates grants that had already run out -- so
 * ending a delegation meant waiting up to thirty days for its expiry.
 */
async function IssuedGrants({ brandId }: { brandId: string | null }) {
  const grants = await loadIssuedGrants(brandId);
  if (grants.length === 0) return null;
  return (
    <div className="card">
      <h2>Delegated access your brand has issued</h2>
      <p className="muted">
        Live grants only. Revoking one ends it immediately — the grantee stops resolving your
        brand&apos;s numbers on their next request.
      </p>
      <table>
        <thead>
          <tr><th>Grantee</th><th>Scopes</th><th>Expires</th><th /></tr>
        </thead>
        <tbody>
          {grants.map((grant) => (
            <tr key={grant.id}>
              <td>{grant.granteeUserId}</td>
              <td>{grant.scope.join(', ') || '—'}</td>
              <td>{new Date(grant.expiresAt).toISOString().slice(0, 10)}</td>
              <td>
                <form action={revokeDelegatedAccessAction}>
                  <input type="hidden" name="grantId" value={grant.id} />
                  <button type="submit">Revoke</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Props = { searchParams: Promise<{ enrollment?: string }> };
const ENROLLMENT_NOTICES: Record<string, string> = {
  accepted: 'Agreement accepted. Network membership is now active.',
  rejected: 'Enrollment declined. Network membership remains inactive.',
  stale: 'That pending agreement is no longer available. The page has been refreshed.',
  failed: 'The agreement response could not be saved. Try again.',
  invalid: 'The agreement response was invalid. Review the invitation and try again.',
  unauthorized: 'Only this brand’s owner can respond to its agreement.',
  unavailable: 'Agreement responses are unavailable because Supabase is not configured.',
};

export default async function NetworkPage({ searchParams }: Props) {
  const [reports, session, query] = await Promise.all([
    loadNetworkReports(), currentSession(), searchParams,
  ]);
  return (
    <>
      <h1>Network reporting</h1>
      <p className="subtitle">
        Orders and gross for the last 30 days, per brand, across the networks you administer or
        hold a live grant on. Counts and sums only — no order or guest record crosses a tenant.
      </p>
      {query.enrollment && ENROLLMENT_NOTICES[query.enrollment] ? (
        <div
          className={query.enrollment === 'accepted' ? 'notice' : 'notice danger'}
          role="status"
        >
          {ENROLLMENT_NOTICES[query.enrollment]}
        </div>
      ) : null}
      {session?.brandId && hasRole(session, 'brand_owner') ? (
        <PendingEnrollmentReview brandId={session.brandId} />
      ) : null}
      {reports.length === 0 ? (
        <div className="notice">
          You are not a member of a franchise network, and no delegated network grant is currently
          live for your account.
        </div>
      ) : null}
      {reports.map((report) => {
        const totals = networkTotals(report.brands);
        return (
          <div className="card" key={report.networkId}>
            <h2>
              {report.networkName ?? 'Delegated network'} — {formatMoney(totals.grossCents30d)} across{' '}
              {report.brands.length.toLocaleString('en-US')}{' '}
              {report.brands.length === 1 ? 'brand' : 'brands'}
            </h2>
            <p className="muted">
              {totals.orders30d.toLocaleString('en-US')} orders in the window.
              {report.networkName === null
                ? ' Your grant covers the brands below, not the whole network.'
                : ''}
            </p>
            {report.brands.length === 0 ? (
              <div className="notice">No brands are enrolled in this network yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Brand</th>
                    <th className="num">Orders</th>
                    <th className="num">Gross</th>
                    <th className="num">Average order</th>
                  </tr>
                </thead>
                <tbody>
                  {report.brands.map((brand) => (
                    <tr key={brand.brandId}>
                      <td>{brand.brandName}</td>
                      <td className="num">{brand.orders30d.toLocaleString('en-US')}</td>
                      <td className="num">{formatMoney(brand.grossCents30d)}</td>
                      <td className="num">
                        {brand.orders30d > 0
                          ? formatMoney(Math.trunc(brand.grossCents30d / brand.orders30d))
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      {hasRole(session, 'brand_owner') ? <IssuedGrants brandId={session?.brandId ?? null} /> : null}
    </>
  );
}
