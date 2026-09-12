import Link from 'next/link';

import type { FranchiseConsentReadiness } from '@/lib/franchise-enrollment';

import { activateOrganizationAction } from '../readiness-actions';

export type Check = {
  check_key: string;
  required: boolean;
  status: string;
  evidence: unknown;
  updated_at: string;
};

export const LABELS: Record<string, string> = {
  database: 'Database tenant', owner: 'Owner access', modules: 'Module installation',
  location: 'First location', tenant_artifacts: 'Tenant artifacts',
  release_approval: 'Release approval', payment_provider: 'Payment provider',
};

export function statusClass(status: string): string {
  if (status === 'passed' || status === 'active') return 'pill success';
  if (status === 'failed') return 'pill danger';
  return 'pill warning';
}

type Props = {
  brandId: string;
  brandStatus: string;
  run: { owner_email: string; stage: string } | null;
  passed: number;
  requiredCount: number;
  ready: boolean;
  consent: FranchiseConsentReadiness;
  checks: Check[];
};

export function ReadinessOverview({
  brandId, brandStatus, run, passed, requiredCount, ready, consent, checks,
}: Props) {
  return (
    <>
      <div className="card readiness-summary">
        <div>
          <span className={statusClass(brandStatus)}>{brandStatus}</span>
          <h2>{passed} of {requiredCount} required checks passed</h2>
          <p className="muted">Owner: {run?.owner_email ?? 'Not recorded'} · Stage: {run?.stage ?? 'legacy'}</p>
        </div>
        {brandStatus === 'provisioning' ? (
          <form action={activateOrganizationAction}>
            <input type="hidden" name="brandId" value={brandId} />
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
    </>
  );
}
