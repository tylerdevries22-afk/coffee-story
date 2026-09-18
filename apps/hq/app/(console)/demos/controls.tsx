import type { DemoFactoryReadiness, DemoFactorySettings } from '@/lib/demo-factory/console-data';
import { formatMicrousd } from '@/lib/demo-factory/prices';

import { saveDemoLimits, switchDemoFactory } from './actions';

/** Dollars for an input's value: `10.00`, never a float's `10.000000001`. */
function dollarsField(microusd: number): string {
  const cents = Math.round(microusd / 10_000);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

const REQUIREMENTS: readonly { key: keyof DemoFactoryReadiness; label: string; why: string }[] = [
  { key: 'placesKey', label: 'Google Places key', why: 'finds businesses and reads their listings' },
  { key: 'builderName', label: 'DEMO_BUILDER_NAME', why: 'names who built every demo, on every page' },
  { key: 'openAiKey', label: 'OpenAI key', why: 'reads each website for its menu and colors' },
];

/**
 * The switch, the brakes and what is still missing. Off is the default and
 * the state to reach for first: it stops new work at the next claim without
 * touching the limits.
 */
export function DemoFactoryControls({ settings, readiness }: {
  settings: DemoFactorySettings | null;
  readiness: DemoFactoryReadiness;
}) {
  const on = settings?.enabled === true;
  return (
    <div className="factory-layout">
      <section className="factory-panel">
        <div className="factory-panel-heading">
          <div><p className="factory-eyebrow">Kill switch</p><h2>{on ? 'The factory is on' : 'The factory is off'}</h2></div>
          <span className={on ? 'factory-state factory-state-running' : 'factory-state'}>{on ? 'on' : 'off'}</span>
        </div>
        <form action={switchDemoFactory} className="factory-form">
          <input type="hidden" name="enabled" value={on ? 'off' : 'on'} />
          <p className="factory-muted">
            {on
              ? 'Turning it off stops new businesses at the next claim. Anything already being built finishes, because its calls are paid for.'
              : 'Turning it on lets the scheduled run build queued businesses, within the daily count and budget below.'}
          </p>
          <button className={on ? 'button secondary' : 'button'} type="submit" disabled={settings === null}>
            {on ? 'Turn the factory off' : 'Turn the factory on'}
          </button>
        </form>
        <ul className="factory-muted">
          {REQUIREMENTS.map((requirement) => (
            <li key={requirement.key}>
              <strong>{readiness[requirement.key] ? 'Configured' : 'Missing'}</strong>: {requirement.label}, which {requirement.why}.
            </li>
          ))}
        </ul>
      </section>

      <section className="factory-panel">
        <div className="factory-panel-heading">
          <div><p className="factory-eyebrow">Daily brakes</p><h2>Count and budget</h2></div>
          {settings ? <span className="badge">{formatMicrousd(settings.dailyBudgetMicrousd)} a day</span> : null}
        </div>
        <form action={saveDemoLimits} className="factory-form">
          <div className="factory-field-row">
            <label className="field">Businesses per day
              <input name="dailyLimit" inputMode="numeric" pattern="[0-9]{1,3}" required
                defaultValue={String(settings?.dailyLimit ?? 100)} />
            </label>
            <label className="field">Budget per day (US$)
              <input name="dailyBudget" inputMode="decimal" pattern="[0-9]{1,4}(\.[0-9]{1,2})?" required
                defaultValue={dollarsField(settings?.dailyBudgetMicrousd ?? 10_000_000)} />
            </label>
          </div>
          <div className="factory-form-footer">
            <p>Both are checked each time work is handed out. The day is UTC, and spend is at list price before free allowances.</p>
            <button className="button secondary" type="submit" disabled={settings === null}>Save limits</button>
          </div>
        </form>
      </section>
    </div>
  );
}
