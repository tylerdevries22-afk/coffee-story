import { loadCustomers } from '@/lib/data';
import { formatMoney } from '@/lib/kpi';
// The console is live data behind a session: never prerender a fixture
// snapshot at build time and serve it as if it were today's numbers.
export const dynamic = 'force-dynamic';


export default async function CustomersPage() {
  const customers = await loadCustomers();
  return (
    <>
      <h1>Customers</h1>
      <p className="subtitle">Brand-scoped by RLS: a search here can never cross into another brand&rsquo;s guests.</p>
      <div className="card">
        <label className="field">Search<input placeholder="Name or phone" /></label>
        <table>
          <thead>
            <tr><th>Customer</th><th>Phone</th><th className="num">Points</th><th className="num">Lifetime</th><th>Last order</th><th /></tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td><strong>{customer.name}</strong></td>
                <td>{customer.phone}</td>
                <td className="num">{customer.points}</td>
                <td className="num">{formatMoney(customer.lifetimeCents)}</td>
                <td>{new Date(customer.lastOrderAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                <td className="num"><button className="button secondary" type="button">Adjust points</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="notice">
        Adjustments write loyalty_events rows (type: adjust) with the operator
        recorded — the balance is a projection, never edited directly.
      </div>
    </>
  );
}
