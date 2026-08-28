import { randomUUID } from 'node:crypto';

import { factoryTasks, parseOnboardingIntake, proposalTermsFor } from '@platform/factory';
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { start } from 'workflow/api';

import { Icon, type IconName } from '@/components/icon';
import { currentSession, hasRole } from '@/lib/auth';
import { serverEnv, serviceDb } from '@/lib/api-auth';
import { loadFactoryOverview } from '@/lib/factory-data';
import { formatMoney } from '@/lib/kpi';
import { serverClient } from '@/lib/supabase-server';
import { runPlatformFactory } from '@/workflows/platform-factory';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const APP_SURFACES: readonly {
  name: string;
  purpose: string;
  delivery: string;
  icon: IconName;
}[] = [
  { name: 'Customer', purpose: 'Browse, order, rewards, and account', delivery: 'Branded mobile and web', icon: 'brand' },
  { name: 'Operator', purpose: 'Orders, calendar, crew, and training', delivery: 'Shared staff application', icon: 'users' },
  { name: 'Kiosk', purpose: 'On-site ordering from the live catalog', delivery: 'Paired progressive web app', icon: 'kiosk' },
  { name: 'Pickup display', purpose: 'Realtime preparation and pickup status', delivery: 'Paired display application', icon: 'activity' },
  { name: 'HQ', purpose: 'Tenant control plane and reporting', delivery: 'Role-scoped web console', icon: 'dashboard' },
];

async function createOnboardingRun(formData: FormData): Promise<void> {
  'use server';

  const session = await currentSession();
  if (!hasRole(session, 'platform_admin')) redirect('/onboarding?error=forbidden');

  const parsed = parseOnboardingIntake({
    businessName: formData.get('businessName'),
    tenantSlug: formData.get('tenantSlug'),
    industryKey: formData.get('industryKey'),
    locationName: formData.get('locationName'),
    timezone: formData.get('timezone'),
    websiteUrl: formData.get('websiteUrl'),
  });
  if (!parsed.ok) redirect(`/onboarding?error=invalid&detail=${encodeURIComponent(parsed.issues[0] ?? '')}`);

  const signedClient = await serverClient();
  const environment = serverEnv();
  if (!signedClient || !environment) redirect('/onboarding?preview_created=1');

  const user = await signedClient.auth.getUser();
  if (!user.data.user) redirect('/login');

  const database = serviceDb(environment);
  const blueprint = await database
    .from('industry_blueprints')
    .select('id')
    .eq('industry_key', parsed.value.industryKey)
    .eq('status', 'active')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (blueprint.error || !blueprint.data) redirect('/onboarding?error=blueprint');

  const result = await database.rpc('create_platform_onboarding_run', {
    input_blueprint_id: blueprint.data.id,
    input_business_name: parsed.value.businessName,
    input_tenant_slug: parsed.value.tenantSlug,
    input_location_name: parsed.value.locationName,
    input_timezone: parsed.value.timezone,
    input_website_url: parsed.value.websiteUrl ?? '',
    input_idempotency_key: randomUUID(),
    input_created_by: user.data.user.id,
    input_tasks: factoryTasks(),
  });
  if (result.error || typeof result.data !== 'string') redirect('/onboarding?error=create');

  try {
    await start(runPlatformFactory, [{ runId: result.data }]);
  } catch {
    await Promise.all([
      database.from('platform_onboarding_runs').update({ state: 'failed', last_error_code: 'workflow_start_failed' }).eq('id', result.data),
      database.from('platform_onboarding_tasks').update({ state: 'failed', last_error_code: 'workflow_start_failed' }).eq('run_id', result.data).eq('task_key', 'research-brand'),
    ]);
    redirect('/onboarding?error=automation');
  }

  revalidatePath('/onboarding');
  redirect('/onboarding?created=1');
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function runStateLabel(state: string): string {
  return state.replaceAll('_', ' ');
}

export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  const [session, client, params] = await Promise.all([currentSession(), serverClient(), searchParams]);
  const admin = hasRole(session, 'platform_admin');
  const overview = await loadFactoryOverview(client);
  const terms = proposalTermsFor('initial', 'finance');
  const liveRuns = overview.runs.filter((run) => run.state === 'live').length;
  const blockedRuns = overview.runs.filter((run) => run.state === 'blocked').length;
  const error = firstParam(params.error);
  const detail = firstParam(params.detail);

  return (
    <main className="factory-page">
      <header className="factory-heading">
        <div>
          <p className="factory-eyebrow">Platform factory</p>
          <h1>Demo to live</h1>
          <p className="subtitle">Create an industry stack once, then guide each client through verified access, hosted provisioning, content release, and launch.</p>
        </div>
        <Link className="button factory-button" href="/wall">
          <Icon name="wall" size={17} /> Open live wall
        </Link>
      </header>

      {params.created ? <div className="notice">The onboarding run was created and its first research task is ready.</div> : null}
      {params.preview_created ? <div className="notice">Preview accepted. Configure the hosted factory environment to persist and execute this run.</div> : null}
      {error ? (
        <div className="notice factory-notice-danger" role="alert">
          {error === 'forbidden' ? 'Only platform administrators can create a tenant stack.' : null}
          {error === 'invalid' ? detail || 'Review the onboarding fields and try again.' : null}
          {error === 'blueprint' ? 'The selected industry blueprint is not available.' : null}
          {error === 'create' ? 'The run could not be created. No infrastructure or billing changes were made.' : null}
          {error === 'automation' ? 'The run was saved, but its hosted automation could not start. No provider resources were created.' : null}
        </div>
      ) : null}
      {overview.issue ? <div className="notice">{overview.issue} Apply the factory migration to the hosted Coffee Story project to enable live runs.</div> : null}

      <section className="factory-metrics" aria-label="Factory overview">
        <article><span>Deployment model</span><strong>One stack</strong><small>per industry</small></article>
        <article><span>Application surfaces</span><strong>{APP_SURFACES.length}</strong><small>shared data contract</small></article>
        <article><span>Live tenant stacks</span><strong>{liveRuns}</strong><small>{overview.source} source</small></article>
        <article><span>Needs access</span><strong>{blockedRuns}</strong><small>fail-closed runs</small></article>
      </section>

      <div className="factory-layout">
        <section className="factory-panel factory-intake">
          <div className="factory-panel-heading">
            <div><p className="factory-eyebrow">New tenant</p><h2>Create the demo workspace</h2></div>
            <span className="badge">Step 1 of 4</span>
          </div>
          {admin ? (
            <form action={createOnboardingRun} className="factory-form">
              <div className="factory-field-row">
                <label className="field">Business name<input required minLength={2} maxLength={120} name="businessName" placeholder="Juniper Coffee" /></label>
                <label className="field">Tenant slug<input required maxLength={63} name="tenantSlug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="juniper-coffee" /></label>
              </div>
              <div className="factory-field-row">
                <label className="field">Industry
                  <select name="industryKey" defaultValue="coffee-shop"><option value="coffee-shop">Coffee shop</option></select>
                </label>
                <label className="field">First location<input required minLength={2} maxLength={120} name="locationName" placeholder="Downtown" /></label>
              </div>
              <div className="factory-field-row">
                <label className="field">Website <span>(optional)</span><input type="url" name="websiteUrl" placeholder="https://example.com" /></label>
                <label className="field">Timezone<input required name="timezone" defaultValue="America/Denver" /></label>
              </div>
              <div className="factory-form-footer">
                <p>Creating a run researches the public brand, builds a private demo, then pauses before any provider credential or paid resource is required.</p>
                <button className="button" type="submit"><Icon name="onboarding" size={17} /> Create private demo</button>
              </div>
            </form>
          ) : <div className="factory-empty"><Icon name="lock" size={22} /><strong>Platform administrator access required</strong><p>Tenant creation and provider credentials are hidden from brand and location roles.</p></div>}
        </section>

        <aside className="factory-panel factory-terms">
          <div className="factory-panel-heading"><div><p className="factory-eyebrow">Proposal terms</p><h2>Transparent from day one</h2></div></div>
          <dl>
            <div><dt>First 30 days</dt><dd>$0 setup + $0 platform</dd></div>
            <div><dt>App-order commission</dt><dd>2% then 1.5% above $25k</dd></div>
            <div><dt>Setup financing</dt><dd>{formatMoney(terms.setupInstallmentCents)} × {terms.setupInstallments}</dd></div>
            <div><dt>Platform after trial</dt><dd>{formatMoney(terms.platformMonthlyCents)}/month</dd></div>
          </dl>
          <p className="factory-muted">The day-90 guarantee is evaluated from authoritative Square and app-order gross. No billing entitlement is inferred from analytics events.</p>
        </aside>
      </div>

      <section className="factory-panel">
        <div className="factory-panel-heading"><div><p className="factory-eyebrow">Shared platform</p><h2>Five synchronized applications</h2></div><span className="badge success">One published release</span></div>
        <div className="factory-app-grid">
          {APP_SURFACES.map((surface) => (
            <article key={surface.name}>
              <span className="factory-app-icon"><Icon name={surface.icon} size={19} /></span>
              <div><strong>{surface.name}</strong><p>{surface.purpose}</p><small>{surface.delivery}</small></div>
              <span className="factory-app-state">Included</span>
            </article>
          ))}
        </div>
      </section>

      <section className="factory-panel">
        <div className="factory-panel-heading"><div><p className="factory-eyebrow">Client handoff</p><h2>Credential walkthroughs</h2></div><span className="badge">Official sources</span></div>
        <div className="factory-guide-grid">
          {overview.guides.map((guide) => (
            <article key={guide.provider}>
              <div className="factory-guide-heading"><strong>{guide.title}</strong><span>{guide.ownerRole.replaceAll('_', ' ')}</span></div>
              <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
              <a href={guide.officialUrl} target="_blank" rel="noreferrer">Open official walkthrough <Icon name="external" size={14} /></a>
            </article>
          ))}
        </div>
      </section>

      <section className="factory-panel">
        <div className="factory-panel-heading"><div><p className="factory-eyebrow">Automation runs</p><h2>Demo-to-live pipeline</h2></div><span className="badge">{overview.runs.length} tenants</span></div>
        <div className="factory-run-list">
          {overview.runs.length ? overview.runs.map((run) => {
            const progress = run.totalTasks ? Math.round((run.completedTasks / run.totalTasks) * 100) : 0;
            return (
              <article className="factory-run" key={run.id}>
                <div className="factory-run-primary">
                  <div><strong>{run.businessName}</strong><span>{run.tenantSlug}</span></div>
                  <span className={`factory-state factory-state-${run.state}`}>{runStateLabel(run.state)}</span>
                </div>
                <div className="factory-progress" aria-label={`${progress}% complete`}><span style={{ width: `${progress}%` }} /></div>
                <div className="factory-run-meta">
                  <span>{run.completedTasks} of {run.totalTasks} tasks</span>
                  <span>{run.verifiedCredentials} of {run.requiredCredentials} credentials verified</span>
                  <span>Stage: {runStateLabel(run.stage)}</span>
                </div>
              </article>
            );
          }) : <div className="factory-empty"><Icon name="onboarding" size={22} /><strong>No tenant runs yet</strong><p>Create a private demo to begin the verified pipeline.</p></div>}
        </div>
        <p className="factory-source">Source: {overview.source}. A failed task leaves the previous hosted release active and records a safe, auditable failure.</p>
      </section>
    </main>
  );
}
