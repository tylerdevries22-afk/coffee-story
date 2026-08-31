import Link from 'next/link';

import { loadMenu } from '@/lib/data';
import { currentSession, hasRole } from '@/lib/auth';
import { formatMoney } from '@/lib/kpi';
// The console is live data behind a session: never prerender a fixture
// snapshot at build time and serve it as if it were today's numbers.
export const dynamic = 'force-dynamic';

type MenuPageProps = { searchParams: Promise<{ imported?: string; preview?: string }> };

function importNotice(params: { imported?: string; preview?: string }): string | null {
  if (!params.imported) return null;
  if (params.imported === 'denied') return 'Only a brand owner can import a menu.';
  const count = Number(params.imported);
  if (!Number.isInteger(count) || count < 0) return null;
  return params.preview
    ? `Parsed ${count} item${count === 1 ? '' : 's'} — connect a database to import them.`
    : `Imported ${count} item${count === 1 ? '' : 's'}.`;
}

export default async function MenuPage({ searchParams }: MenuPageProps) {
  const [menu, session, params] = await Promise.all([loadMenu(), currentSession(), searchParams]);
  const canImport = hasRole(session, 'brand_owner');
  const notice = importNotice(params);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Menu</h1>
          <p className="subtitle">Brand-wide catalog. Pushing publishes to every location; 86s stay per-location on the operator app.</p>
        </div>
        {canImport ? <Link href="/menu/import" className="button secondary">Import CSV</Link> : null}
      </div>
      {notice ? <div className="notice" role="status">{notice}</div> : null}
      <div className="card">
        <table>
          <thead>
            <tr><th>Item</th><th>Category</th><th className="num">Price</th><th className="num">Modifier groups</th><th>Status</th></tr>
          </thead>
          <tbody>
            {menu.map((item) => (
              <tr key={item.id}>
                <td><strong>{item.name}</strong></td>
                <td>{item.category}</td>
                <td className="num">{formatMoney(item.priceCents)}</td>
                <td className="num">{item.modifierGroups}</td>
                <td>{item.is86d ? <span className="pill danger">86&rsquo;d today</span> : <span className="pill success">Listed</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="button" type="button">Push menu to all locations</button>
    </>
  );
}
