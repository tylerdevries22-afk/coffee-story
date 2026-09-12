'use server';


import { serverEnv, serviceDb } from '@/lib/api-auth';
import { currentAuthUser, currentSession } from '@/lib/auth';
import { addDemoLocation } from '@/lib/demo-locations';
import { addDemoOrg } from '@/lib/demo-orgs';
import type { OrganizationActionState } from '@/lib/organization-action-state';
import { startFactoryRun } from '@/lib/organization-factory-run';
import { parseOrgDraft } from '@/lib/org-input';
import {
  organizationFailure, organizationInvitationUrl, reconcileUnknownProvisioningInvitation,
  rollbackInvitationSafely,
} from '@/lib/organization-provisioning-helpers';
import { resolveOrInviteStaffUser } from '@/lib/staff-admin';
import { switchWorkspaceToProvisionedOrg } from '@/lib/organization-workspace-switch';
import { isConfigured, serverClient } from '@/lib/supabase-server';
import { tenantPackFromDraft, tryWriteTenantPack } from '@/lib/tenant-pack-write';

function text(formData: FormData, key: string): string {
  const value = formData.get(key); return typeof value === 'string' ? value : '';
}

export async function createOrganizationAction(
  _previous: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  const [session, authUser] = await Promise.all([currentSession(), currentAuthUser()]);
  if (!session && !authUser) {
    return { kind: 'error', message: 'Sign in to create an organization.' };
  }
  const parsed = parseOrgDraft({
    name: text(formData, 'name'), ownerEmail: text(formData, 'ownerEmail'),
    organizationKind: text(formData, 'organizationKind'),
    industryKey: text(formData, 'industryKey'), blueprintKey: text(formData, 'blueprintKey'),
    networkSlug: text(formData, 'networkSlug'), territory: text(formData, 'territory'),
    moduleKeys: formData.getAll('moduleKeys').map(String),
    connectorIds: formData.getAll('connectorIds').map(String),
    location: {
      name: text(formData, 'locationName'), street: text(formData, 'street'),
      city: text(formData, 'city'), region: text(formData, 'region'),
      postal: text(formData, 'postal'), timezone: text(formData, 'timezone'),
      openTime: text(formData, 'openTime'), closeTime: text(formData, 'closeTime'),
      days: formData.getAll('days').map(String),
    },
  });
  if (!parsed.ok) return { kind: 'error', message: parsed.error };
  const draft = parsed.draft;
  const idempotencyKey = text(formData, 'idempotencyKey');
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
    return { kind: 'error', message: 'This form expired. Reload it and try again.' };
  }

  let brandId: string;
  let locationId: string | null = null;
  let factoryIssue = false;
  if (!isConfigured()) {
    brandId = draft.slug;
    addDemoOrg({
      id: brandId, slug: draft.slug, name: draft.name, kind: 'brand',
      brandConfig: draft.brandConfig,
      moduleKeys: draft.modules.map((module) => module.key), connectorIds: draft.connectors,
    });
    if (draft.location) {
      locationId = `loc-${crypto.randomUUID()}`.slice(0, 60);
      addDemoLocation(brandId, {
        id: locationId, name: draft.location.name, city: draft.location.city,
        timezone: draft.location.timezone, hours: draft.location.hoursSummary,
        squareConnected: false, orderingPaused: false,
      });
    }
  } else {
    const client = await serverClient();
    const environment = serverEnv();
    const callback = organizationInvitationUrl({
      hqUrl: process.env.NEXT_PUBLIC_HQ_URL, vercelEnvironment: process.env.VERCEL_ENV,
      vercelUrl: process.env.VERCEL_URL,
    });
    const actorId = session?.userId ?? authUser?.userId ?? null;
    if (!client || !environment || !callback || !actorId) {
      return { kind: 'error', message: 'Owner invitations are not configured for this deployment.' };
    }
    const database = serviceDb(environment);
    let owner: { userId: string; invited: boolean } | null = null;
    try {
      if (draft.networkSlug) {
        const network = await client.from('franchise_networks').select('id')
          .eq('slug', draft.networkSlug).eq('status', 'active').maybeSingle();
        if (network.error || !network.data) {
          return { kind: 'error', message: 'That franchise network was not found.' };
        }
      }
      owner = await resolveOrInviteStaffUser(
        database.auth.admin, draft.ownerEmail, callback,
      );
      const result = await client.rpc('provision_platform_organization_with_connectors', {
        p_idempotency_key: idempotencyKey, p_name: draft.name, p_slug: draft.slug,
        p_owner_user_id: owner.userId, p_owner_email: draft.ownerEmail,
        p_organization_kind: draft.organizationKind, p_industry_key: draft.industryKey,
        p_blueprint_key: draft.blueprintKey, p_brand_config: draft.brandConfig,
        p_location: draft.location, p_modules: draft.modules,
        p_network_slug: draft.networkSlug, p_territory: draft.territory,
        p_inheritance_policy: draft.inheritancePolicy,
        p_connectors: draft.connectors,
      });
      if (result.error) {
        await rollbackInvitationSafely(database.auth.admin, owner);
        return { kind: 'error', message: organizationFailure(result.error.message) };
      }
      const value = result.data as { brandId?: unknown; locationId?: unknown } | null;
      if (typeof value?.brandId !== 'string') {
        return { kind: 'error', message: 'Provisioning returned an invalid result.' };
      }
      brandId = value.brandId;
      locationId = typeof value.locationId === 'string' ? value.locationId : null;
      try {
        factoryIssue = !await startFactoryRun({ database, actorId: actorId,
          idempotencyKey, draft });
      } catch {
        factoryIssue = true;
        console.error(JSON.stringify({
          severity: 'error', component: 'organization-provisioning',
          event: 'factory.run_start_failed', brandId,
        }));
      }
    } catch {
      if (owner) await reconcileUnknownProvisioningInvitation(database.auth.admin, owner,
        database.from('organization_provisioning_runs').select('brand_id')
          .eq('idempotency_key', idempotencyKey).maybeSingle());
      return { kind: 'error', message: 'The owner invitation could not be prepared. Try again.' };
    }
  }

  try {
    tryWriteTenantPack(tenantPackFromDraft(draft));
  } catch (error) {
    console.error(JSON.stringify({
      severity: 'error',
      component: 'organization-provisioning',
      event: 'tenant_pack.build_failed',
      slug: draft.slug,
      message: error instanceof Error ? error.message : 'build_failed',
    }));
  }

  const workspaceSession = {
    userId: session?.userId ?? authUser?.userId ?? null,
    email: session?.email ?? authUser?.email ?? draft.ownerEmail,
    role: session?.role ?? 'brand_owner',
    brandId,
    brandName: draft.name,
  } as const;
  const switched = await switchWorkspaceToProvisionedOrg({
    session: workspaceSession, brandId, locationId, factoryIssue,
  });
  return switched;
}
