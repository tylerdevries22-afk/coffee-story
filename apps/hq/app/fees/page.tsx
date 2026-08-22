import { currentSession, hasRole } from '@/lib/auth';
import { loadFees } from '@/lib/data';
import { formatMoney } from '@/lib/kpi';

/** The platform's own revenue: platform_admin only (rule 3 / RLS mirror). */
export default async function FeesPage() {
  const session = await currentSession();
  if (!hasRole(session, 'platform_admin')) {
    return (
      <>
        <h1>Platform fees</h1>
        <div className="notice">This report is available to the platform operator only.</div>
      </>
    );
  }
  const fees = await loadFees();
  const months = [...new Set(fees.map((row) => row.month))].sort().reverse();
  return (
    <>
      <h1>Platform fees</h1>
      <p className="subtitle">app_fee_money collected per payment, tiered per location per calendar month.</p>
      {months.map((month) => {
        const rows = fees.filter((row) => row.month === month);
        const totalFees = rows.reduce((sum, row) => sum + row.feeCents, 0);
        return (
          <div className="card" key={month}>
            <h2>{month} — {formatMoney(totalFees)} collected</h2>
            <table>
              <thead>
                <tr><th>Location</th><th className="num">Gross processed</th><th className="num">Payments</th><th className="num">Fees</th><th className="num">Effective rate</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.locationId}>
                    <td>{row.locationName}</td>
                    <td className="num">{formatMoney(row.grossCents)}</td>
                    <td className="num">{row.payments.toLocaleString('en-US')}</td>
                    <td className="num">{formatMoney(row.feeCents)}</td>
                    <td className="num">{((row.feeCents / row.grossCents) * 10_000 / 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
