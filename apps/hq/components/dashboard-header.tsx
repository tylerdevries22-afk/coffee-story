import Link from 'next/link';

import { Icon, type IconName } from './icon';

type DashboardHeaderProps = {
  readonly locationLabel: string;
  readonly rangeLabel: string;
  readonly action: { href: string; label: string; icon: IconName };
};

export function DashboardHeader({ locationLabel, rangeLabel, action }: DashboardHeaderProps) {
  return (
    <header className="hq-dashboard-header">
      <div>
        <p className="hq-eyebrow">Network control</p>
        <h1>Network overview</h1>
        <p>Revenue, channel health, and store-level performance for {locationLabel}.</p>
        <div className="hq-dashboard-meta" aria-label="Reporting context">
          <span><Icon name="locations" size={14} />{locationLabel}</span>
          <span><Icon name="activity" size={14} />{rangeLabel}</span>
        </div>
      </div>
      <Link href={action.href} className="hq-primary-action">
        <Icon name={action.icon} size={16} />{action.label}
      </Link>
    </header>
  );
}
