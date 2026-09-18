import type { DemoDailyCost } from '@/lib/demo-factory/console-data';
import { formatMicrousd } from '@/lib/demo-factory/prices';

const SKU_LABELS: Readonly<Record<string, string>> = {
  text_search_ids: 'Text search (IDs only, free)',
  place_details_enterprise: 'Place Details (Enterprise)',
  place_details_atmosphere: 'Place Details (Enterprise + Atmosphere)',
  place_photo: 'Place photo',
  input_tokens: 'Input tokens',
  cached_input_tokens: 'Cached input tokens',
  output_tokens: 'Output tokens',
};

function lineName(row: DemoDailyCost): string {
  const sku = SKU_LABELS[row.sku] ?? row.sku.replaceAll('_', ' ');
  return row.model ? `${sku}, ${row.model}` : sku;
}

/**
 * Spend per UTC day and line, newest first -- the view that makes a runaway
 * visible within the day it starts, rather than on the invoice. List prices,
 * before free allowances, so it errs high.
 */
export function DemoDailyCosts({ days }: { days: readonly DemoDailyCost[] }) {
  const totals = new Map<string, number>();
  for (const row of days) totals.set(row.day, (totals.get(row.day) ?? 0) + row.costMicrousd);
  return (
    <section className="card">
      <h2>Spend by day</h2>
      {days.length === 0 ? (
        <p className="factory-muted">Nothing spent in the last 14 days.</p>
      ) : (
        <table>
          <thead>
            <tr><th>Day (UTC)</th><th>Line</th><th className="num">Quantity</th><th className="num">Cost</th><th className="num">Day total</th></tr>
          </thead>
          <tbody>
            {days.map((row, index) => (
              <tr key={`${row.day}-${row.provider}-${row.sku}-${row.model ?? ''}-${index}`}>
                <td>{row.day}</td>
                <td>{lineName(row)}</td>
                <td className="num">{row.quantity.toLocaleString('en-US')}</td>
                <td className="num">{formatMicrousd(row.costMicrousd)}</td>
                <td className="num">{days[index - 1]?.day === row.day ? '' : formatMicrousd(totals.get(row.day) ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
