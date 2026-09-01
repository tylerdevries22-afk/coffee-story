import Link from 'next/link';

import type { DropSummary } from '@/lib/demo-data';
import { formatMoney } from '@/lib/kpi';

import { Icon, type IconName } from './icon';

export type DashboardAction = {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
};

function liveDropEnd(endsAt: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(endsAt));
}

export function DashboardActionCenter({
  actions,
  liveDrop,
}: {
  readonly actions: readonly DashboardAction[];
  readonly liveDrop?: DropSummary;
}) {
  return (
    <aside className="hq-action-stack" aria-label="Action center">
      <section className="hq-panel hq-live-drop">
        <div className="hq-panel-header">
          <div>
            <p className="hq-eyebrow">Active program</p>
            <h2>Live drop</h2>
          </div>
          {liveDrop ? <span className="hq-status-badge"><span />Live</span> : null}
        </div>
        {liveDrop ? (
          <div className="hq-live-drop-body">
            <strong>{liveDrop.title}</strong>
            <p>{liveDrop.itemName} · ends {liveDropEnd(liveDrop.endsAt)} UTC</p>
            <dl>
              <div><dt>Orders</dt><dd>{liveDrop.ordersCount.toLocaleString('en-US')}</dd></div>
              <div><dt>Revenue</dt><dd>{formatMoney(liveDrop.revenueCents)}</dd></div>
            </dl>
            <Link href="/drops">Open drop workspace</Link>
          </div>
        ) : (
          <div className="hq-live-drop-empty">
            <strong>No live drop</strong>
            <p>Schedule the next limited menu moment when the catalog is ready.</p>
            <Link href="/drops">Review drops</Link>
          </div>
        )}
      </section>
      <section className="hq-panel hq-quick-actions">
        <div className="hq-panel-header">
          <div><p className="hq-eyebrow">Shortcuts</p><h2>Keep work moving</h2></div>
        </div>
        <nav aria-label="Dashboard shortcuts">
          {actions.map((action) => (
            <Link href={action.href} key={action.href}>
              <span><Icon name={action.icon} size={17} /></span>
              <span><strong>{action.label}</strong><small>{action.description}</small></span>
              <Icon name="chevron" size={15} />
            </Link>
          ))}
        </nav>
      </section>
    </aside>
  );
}
