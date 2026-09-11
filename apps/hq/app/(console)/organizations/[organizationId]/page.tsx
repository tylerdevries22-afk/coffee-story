import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ProvisioningLoader } from '@/components/provisioning-loader';
import { currentSession, hasRole } from '@/lib/auth';
import { franchiseConsentReadiness } from '@/lib/franchise-enrollment';
import { canTapGoLive } from '@/lib/go-live-access';
import { serverClient } from '@/lib/supabase-server';

import {
  offboardOrganizationAction,
  restoreOrganizationAction,
  suspendOrganizationAction,
} from '../lifecycle-actions';
import { goLiveOrganizationAction } from '../go-live-actions';
import { activateOrganizationAction } from '../readiness-actions';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{
    activation?: string;
    factory?: string;
    lifecycle?: string;
    golive?: string;
  }>;
};
type Check = { check_key: string; required: boolean; status: string; evidence: unknown; updated_at: string };

const LABELS: Record<string, string> = {
  database: 'Database tenant', owner: 'Owner access', modules: 'Module installation',
  location: 'First location', tenant_artifacts: 'Tenant artifacts',
  release_approval: 'Release approval', payment_provider: 'Payment provider',
};
const NOTICES: Record<string, string> = {
  complete: 'Organization activated. Its production surfaces may now serve tenant traffic.',
  'not-ready': 'Activation is blocked until every required readiness check passes.',
  failed: 'Activation was refused. Review the readiness evidence and try again.',
  unavailable: 'Supabase is not configured for activation on this deployment.',
};
const GOLIVE_NOTICES: Record<string, { message: string; failed: boolean }> = {
  started: {
    message: 'Go live started. Production hosts {slug}-hq and {slug}-display will mint now.',
    failed: false,
  },
  'already-live': { message: 'This shop is already live.', failed: false },
  'no-run': { message: 'No factory run found for this shop. Resume onboarding first.', failed: true },
  forbidden: { message: 'Only the owner or a platform admin can tap Go live.', failed: true },
  failed: { message: 'Go live could not start. Check factory credentials and try again.', failed: true },
  unavailable: { message: 'Supabase is not configured for Go live on this deployment.', failed: true },
};

const LIFECYCLE_NOTICES: Record<string, { message: string; failed: boolean }> = {
  suspended: { message: 'Organization suspended. Devices and delegated grants were revoked.', failed: false },
  restored: { message: 'Organization restored. Re-pair devices before they can serve again.', failed: false },
  offboarded: { message: 'Organization offboarded. Access is terminal; data remains for audit.', failed: false },
  failed: { message: 'Lifecycle change was refused. Confirm platform admin access and try again.', failed: true },
  unavailable: { message: 'Supabase is not configured for lifecycle actions on this deployment.', failed: true },
};

function statusClass(status: string): string {
  if (status === 'passed' || status === 'active') return 'pill success';
  if (status === 'failed') return 'pill danger';
  return 'pill warning';
}

export default async function OrganizationReadinessPage({ params, searchParams }: Props) {
  const [{ organizationId }, query, session] = await Promise.all([params, searchParams, currentSession()]);
  // Owner or platform_admin: Go live is an owner/admin action.
  if (!session || !hasRole(session, 'brand_owner')) redirect('/');
  const client = await serverClient();
  if (!client) redirect('/locations');
  const [brandResult, runResult, checksResult, membershipResult, agreementResult] = await Promise.all([
    client.from('brands').select('id,name,slug,status,organization_kind,industry_key,blueprint_key')
      .eq('id', organizationId).maybeSingle(),
    client.from('organization_provisioning_runs').select('stage,owner_email,created_at,updated_at')
      .eq('brand_id', organizationId).maybeSingle(),
    client.from('organization_readiness_checks')
      .select('check_key,required,status,evidence,updated_at').eq('brand_id', organizationId)
      .order('check_key').returns<Check[]>(),
    client.from('franchise_network_brands').select('network_id,status').eq('brand_id', organizationId),
    client.from('franchise_agreements').select('network_id,status')
      .eq('franchisee_brand_id', organizationId),
  ]);

  if (brandResult.error || !brandResult.data || runResult.error || checksResult.error) notFound();

  const factoryRunResult = await client.from('platform_onboarding_runs')
    .select('id,state,stage,business_name,last_error_code,tenant_slug')
    .eq('tenant_slug', brandResult.data.slug)
    .maybeSingle();
  const factoryRun = factoryRunResult.error ? null : factoryRunResult.data;
  let factoryTasks: Array<{ task_key: string; state: string }> = [];
  if (factoryRun?.id) {
    const tasks = await client.from('platform_onboarding_tasks').select('task_key,state')
      .eq('run_id', factoryRun.id).returns<Array<{ task_key: string; state: string }>>();
    factoryTasks = tasks.error ? [] : (tasks.data ?? []);
  }
  const brand = brandResult.data;
  if (session.role !== 'platform_admin' && session.brandId !== brand.id) redirect('/');
  const run = runResult.data;
  const checks = checksResult.data ?? [];
  const consent = franchiseConsentReadiness(
    brand.organization_kind,
    membershipResult.error ? [] : (membershipResult.data ?? []).map((row) => ({
      networkId: row.network_id, status: row.status,
    })),
    agreementResult.error ? [] : (agreementResult.data ?? []).map((row) => ({
      networkId: row.network_id, status: row.status,
    })),
  );
  const required = checks.filter((check) => check.required);
  const requiredCount = required.length + (consent.required ? 1 : 0);
  const passed = required.filter((check) => check.status === 'passed').length
    + (consent.required && consent.ready ? 1 : 0);
  const ready = requiredCount > 0 && passed === requiredCount;
  const completedTaskKeys = factoryTasks
    .filter((task) => task.state === 'completed')
    .map((task) => task.task_key);
  const awaitingGoLive = Boolean(
    factoryRun
    && factoryRun.state !== 'live'
    && (
      factoryRun.last_error_code === 'go_live_required'
      || completedTaskKeys.includes('verify-canary')
    )
    && !completedTaskKeys.includes('promote-live'),
  );
  const showGoLive = canTapGoLive(session) && awaitingGoLive;
  const goliveNotice = query.golive ? GOLIVE_NOTICES[query.golive] : undefined;

  return (
    <>
      <p className="eyebrow">Organization readiness</p>
      <h1>{brand.name}</h1>
      <p className="subtitle">
        {brand.organization_kind} · {brand.industry_key} · {brand.blueprint_key}
      </p>
      {query.activation && NOTICES[query.activation] ? (
        <div className={query.activation === 'complete' ? 'notice' : 'notice danger'} role="status">
          {NOTICES[query.activation]}
        </div>
      ) : null}
      {query.factory === 'failed' ? (
        <div className="notice danger" role="status">
          The organization was provisioned, but factory automation did not start. Resume it from Onboarding.
        </div>
      ) : null}
      {goliveNotice ? (
        <div className={goliveNotice.failed ? 'notice danger' : 'notice'} role="status">
          {goliveNotice.message.replaceAll('{slug}', brand.slug)}
        </div>
      ) : null}
      {(() => {
        const lifecycleNotice = query.lifecycle ? LIFECYCLE_NOTICES[query.lifecycle] : undefined;
        return lifecycleNotice ? (
          <div className={lifecycleNotice.failed ? 'notice danger' : 'notice'} role="status">
            {lifecycleNotice.message}
          </div>
        ) : null;
      })()}

      {factoryRun && factoryRun.state !== 'live' ? (
        <ProvisioningLoader
          run={{
            state: factoryRun.state,
            stage: factoryRun.stage,
            businessName: factoryRun.business_name || brand.name,
            completedTaskKeys,
            blockedErrorCode: factoryRun.last_error_code,
          }}
        />
      ) : null}

      {showGoLive ? (
        <div className="card readiness-summary">
          <div>
            <h2>Go live</h2>
            <p className="muted">
              Sandbox uses preview Supabase, SQUARE_ENV=sandbox, and factory canary.
              Tapping Go live mints {brand.slug}-hq.vercel.app and {brand.slug}-display.vercel.app.
              Guest apps stay paths on HQ. Parked customer/kiosk/operator projects are left alone.
            </p>
          </div>
          <form action={goLiveOrganizationAction}>
            <input type="hidden" name="brandId" value={brand.id} />
            <button className="button" type="submit">Go live</button>
          </form>
        </div>
      ) : null}

      <div className="card readiness-summary">
        <div>
          <span className={statusClass(brand.status)}>{brand.status}</span>
          <h2>{passed} of {requiredCount} required checks passed</h2>
          <p className="muted">Owner: {run?.owner_email ?? 'Not recorded'} · Stage: {run?.stage ?? 'legacy'}</p>
        </div>
        {brand.status === 'provisioning' ? (
          <form action={activateOrganizationAction}>
            <input type="hidden" name="brandId" value={brand.id} />
            <button className="button" type="submit" disabled={!ready}>Activate organization</button>
          </form>
        ) : <Link href="/" className="button">Open dashboard</Link>}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Check</th><th>Requirement</th><th>Status</th><th>Evidence</th></tr></thead>
          <tbody>
            {consent.required ? (
              <tr>
                <td><strong>Franchise consent</strong></td>
                <td>Required</td>
                <td><span className={statusClass(consent.status)}>{consent.status}</span></td>
                <td>{consent.evidence}</td>
              </tr>
            ) : null}
            {checks.map((check) => (
              <tr key={check.check_key}>
                <td><strong>{LABELS[check.check_key] ?? check.check_key}</strong></td>
                <td>{check.required ? 'Required' : 'Optional'}</td>
                <td><span className={statusClass(check.status)}>{check.status}</span></td>
                <td>{check.status === 'passed' ? 'Recorded' : 'Awaiting factory worker'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Lifecycle</h2>
        <p className="muted">
          Suspend pauses access without deleting data. Offboard is terminal.
          Hard deletion of provider projects stays a manual operator step.
        </p>
        {brand.status === 'active' || brand.status === 'suspended' ? (
          <div style={{ display: 'grid', gap: '1rem', maxWidth: '32rem' }}>
            {brand.status === 'active' ? (
              <form action={suspendOrganizationAction} className="location-form">
                <input type="hidden" name="brandId" value={brand.id} />
                <label>
                  Suspension reason
                  <input name="reason" required minLength={4} maxLength={500} placeholder="Why this organization is being suspended" />
                </label>
                <button type="submit" className="button danger">Suspend organization</button>
              </form>
            ) : (
              <form action={restoreOrganizationAction}>
                <input type="hidden" name="brandId" value={brand.id} />
                <button type="submit" className="button">Restore organization</button>
              </form>
            )}
            <form action={offboardOrganizationAction} className="location-form">
              <input type="hidden" name="brandId" value={brand.id} />
              <label>
                Offboard reason
                <input name="reason" required minLength={4} maxLength={500} placeholder="Why this organization is ending" />
              </label>
              <button type="submit" className="button danger">Offboard organization</button>
            </form>
          </div>
        ) : (
          <p className="muted">Lifecycle controls apply after activation (current status: {brand.status}).</p>
        )}
      </div>

      <div className="location-form-actions">
        <Link href="/organizations/new" className="button secondary">Create another</Link>
        <Link href="/network" className="button secondary">Manage network</Link>
      </div>
    </>
  );
}
