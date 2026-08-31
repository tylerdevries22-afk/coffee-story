import { currentSession, hasRole } from '@/lib/auth';
import { loadFees } from '@/lib/data';
import { loadFeeTerms } from '@/lib/fee-terms-data';
import { formatMoney } from '@/lib/kpi';

import { saveLocationFeeOverridesAction } from './actions';
// The console is live data behind a session: never prerender a fixture
// snapshot at build time and serve it as if it were today's numbers.
export const dynamic = 'force-dynamic';


/** The platform's own revenue: platform_admin only (rule 3 / RLS mirror). */
type FeesPageProps = { searchParams: Promise<{ error?: string; updated?: string }> };

export default async function FeesPage({ searchParams }: FeesPageProps) {
  const session = await currentSession();
  if (!hasRole(session, 'platform_admin')) {
    return (
      <>
        <h1>Platform fees</h1>
        <div className="notice">This report is available to the platform operator only.</div>
      </>
    );
  }
  const [fees, terms, params] = await Promise.all([
    loadFees(), loadFeeTerms(session?.userId ?? undefined), searchParams,
  ]);
  const months = [...new Set(fees.map((row) => row.month))].sort().reverse();
  return (
    <>
      <h1>Platform fees</h1>
      <p className="subtitle">app_fee_money collected per payment, tiered per location per calendar month.</p>
      {params.error ? <div className="notice danger" role="status">{params.error}</div> : null}
      {params.updated ? <div className="notice" role="status">Location fee terms were updated and audited.</div> : null}
      <section className="card">
        <h2>Franchise fee overrides</h2>
        <p className="muted">
          Blank fields inherit the brand terms: {terms.brand.feeBps} bps, then {terms.brand.feeBpsTier2} bps
          after {formatMoney(terms.brand.tierThresholdCents)} per location-month.
        </p>
        {terms.locations.length === 0 ? <div className="notice">No locations are available in this organization.</div> : null}
        {terms.locations.map((location) => (
          <form action={saveLocationFeeOverridesAction} className="location-form fee-override-form" key={location.id}>
            <input type="hidden" name="locationId" value={location.id} />
            <h3>{location.name}</h3>
            <div className="location-form-row">
              <label className="field">Base rate (bps)
                <input name="feeBps" inputMode="numeric" pattern="[0-9]*" maxLength={5}
                  defaultValue={location.feeBps ?? ''} placeholder={String(terms.brand.feeBps)} />
              </label>
              <label className="field">Tier-two rate (bps)
                <input name="feeBpsTier2" inputMode="numeric" pattern="[0-9]*" maxLength={5}
                  defaultValue={location.feeBpsTier2 ?? ''} placeholder={String(terms.brand.feeBpsTier2)} />
              </label>
              <label className="field">Threshold (cents)
                <input name="tierThresholdCents" inputMode="numeric" pattern="[0-9]*" maxLength={16}
                  defaultValue={location.tierThresholdCents ?? ''} placeholder={String(terms.brand.tierThresholdCents)} />
              </label>
            </div>
            <button type="submit" className="button secondary">Save {location.name} terms</button>
          </form>
        ))}
      </section>
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
                    <td className="num">{row.grossCents > 0 ? `${((row.feeCents / row.grossCents) * 100).toFixed(2)}%` : '—'}</td>
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
