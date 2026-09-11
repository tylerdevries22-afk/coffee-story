import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { currentSession, hasRole } from '@/lib/auth';
import { franchiseConsentReadiness } from '@/lib/franchise-enrollment';
import { serverClient } from '@/lib/supabase-server';

import {
  offboardOrganizationAction,
  restoreOrganizationAction,
  suspendOrganizationAction,
} from '../lifecycle-actions';
import { activateOrganizationAction } from '../readiness-actions';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ activation?: string; factory?: string; lifecycle?: string }>;
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
  if (!session || !hasRole(session, 'platform_admin')) redirect('/');
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
  const brand = brandResult.data;
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
      {(() => {
        const lifecycleNotice = query.lifecycle ? LIFECYCLE_NOTICES[query.lifecycle] : undefined;
        return lifecycleNotice ? (
          <div className={lifecycleNotice.failed ? 'notice danger' : 'notice'} role="status">
            {lifecycleNotice.message}
          </div>
        ) : null;
      })()}
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
