import { formatMoney } from '@/lib/kpi';
import { loadNetworkReports, networkTotals } from '@/lib/network-reporting';

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
export default async function NetworkPage() {
  const reports = await loadNetworkReports();
  return (
    <>
      <h1>Network reporting</h1>
      <p className="subtitle">
        Orders and gross for the last 30 days, per brand, across the networks you administer or
        hold a live grant on. Counts and sums only — no order or guest record crosses a tenant.
      </p>
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
    </>
  );
}
