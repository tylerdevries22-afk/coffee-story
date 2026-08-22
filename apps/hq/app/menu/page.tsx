import { DEMO_MENU } from '@/lib/demo-data';
import { formatMoney } from '@/lib/kpi';

export default function MenuPage() {
  return (
    <>
      <h1>Menu</h1>
      <p className="subtitle">Brand-wide catalog. Pushing publishes to every location; 86s stay per-location on the operator app.</p>
      <div className="card">
        <table>
          <thead>
            <tr><th>Item</th><th>Category</th><th className="num">Price</th><th className="num">Modifier groups</th><th>Status</th></tr>
          </thead>
          <tbody>
            {DEMO_MENU.map((item) => (
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
