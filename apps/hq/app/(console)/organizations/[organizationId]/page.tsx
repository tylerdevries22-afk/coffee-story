import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { ProvisioningLoader } from '@/components/provisioning-loader';
import { currentSession, hasRole } from '@/lib/auth';
import { franchiseConsentReadiness } from '@/lib/franchise-enrollment';
import { canTapGoLive } from '@/lib/go-live-access';
import { serverClient } from '@/lib/supabase-server';

import { GoLiveBanner } from './go-live-panel';
import { LifecyclePanel } from './lifecycle-panel';
import { ReadinessNotices } from './readiness-notices';
import type { Check } from './readiness-overview';
import { ReadinessOverview } from './readiness-overview';

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

  return (
    <>
      <p className="eyebrow">Organization readiness</p>
      <h1>{brand.name}</h1>
      <p className="subtitle">
        {brand.organization_kind} · {brand.industry_key} · {brand.blueprint_key}
      </p>
      <ReadinessNotices query={query} slug={brand.slug} />

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

      {showGoLive ? <GoLiveBanner brandId={brand.id} slug={brand.slug} /> : null}

      <ReadinessOverview
        brandId={brand.id}
        brandStatus={brand.status}
        run={run}
        passed={passed}
        requiredCount={requiredCount}
        ready={ready}
        consent={consent}
        checks={checks}
      />

      <LifecyclePanel brandId={brand.id} brandStatus={brand.status} />

      <div className="location-form-actions">
        <Link href="/organizations/new" className="button secondary">Create another</Link>
        <Link href="/network" className="button secondary">Manage network</Link>
      </div>
    </>
  );
}
