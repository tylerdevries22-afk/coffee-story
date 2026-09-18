'use server';

import { headers } from 'next/headers';

import { serverEnv, serviceDb } from '@/lib/api-auth';
import { currentSession, mayProvisionOrganizations } from '@/lib/auth';
import { addDemoLocation } from '@/lib/demo-locations';
import { addDemoOrg } from '@/lib/demo-orgs';
import type { OrganizationActionState } from '@/lib/organization-action-state';
import { startFactoryRun } from '@/lib/organization-factory-run';
import { orgInputFromForm } from '@/lib/org-form-input';
import { parseOrgDraft } from '@/lib/org-input';
import {
  organizationFailure, organizationInvitationUrl, reconcileUnknownProvisioningInvitation,
  rollbackInvitationSafely,
} from '@/lib/organization-provisioning-helpers';
import { resolveOrInviteStaffUser } from '@/lib/staff-admin';
import { switchWorkspaceToProvisionedOrg } from '@/lib/organization-workspace-switch';
import { clientIdentity, rateLimited } from '@/lib/rate-limit';
import { isConfigured, serverClient } from '@/lib/supabase-server';
import { tenantFolderTaken, tenantPackFromDraft, tryWriteTenantPack } from '@/lib/tenant-pack-write';

/** Per caller per minute. Creating an organization is an occasional act, not a stream. */
const PROVISION_LIMIT = 10;

function text(formData: FormData, key: string): string {
  const value = formData.get(key); return typeof value === 'string' ? value : '';
}

export async function createOrganizationAction(
  _previous: OrganizationActionState,
  formData: FormData,
): Promise<OrganizationActionState> {
  // Before the session lookup, which is a GoTrue round trip, and long before the
  // owner invitation: a flood should cost this instance a map entry, not mail.
  if (rateLimited(clientIdentity({ headers: await headers() }), 'organizations:create',
    Date.now(), PROVISION_LIMIT)) {
    return { kind: 'error', message: 'Too many attempts. Wait a minute and try again.' };
  }
  const session = await currentSession();
  if (!mayProvisionOrganizations(session)) {
    return {
      kind: 'error',
      message: session
        ? 'Only a platform administrator can create an organization.'
        : 'Sign in to create an organization.',
    };
  }
  const parsed = parseOrgDraft(orgInputFromForm(formData));
  if (!parsed.ok) return { kind: 'error', message: parsed.error };
  const draft = parsed.draft;
  const idempotencyKey = text(formData, 'idempotencyKey');
  if (!/^[0-9a-f-]{36}$/i.test(idempotencyKey)) {
    return { kind: 'error', message: 'This form expired. Reload it and try again.' };
  }
  if (tenantFolderTaken(draft.slug)) {
    return {
      kind: 'error',
      message: `A tenant named ${draft.slug} already exists in this workspace. Choose a different name.`,
    };
  }

  let brandId: string;
  let locationId: string | null = null;
  let factoryIssue = false;
  let packIssue = false;
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
    const actorId = session.userId;
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
    const written = tryWriteTenantPack(tenantPackFromDraft(draft));
    packIssue = written.kind === 'refused' || written.kind === 'failed';
  } catch (error) {
    packIssue = true;
    console.error(JSON.stringify({
      severity: 'error',
      component: 'organization-provisioning',
      event: 'tenant_pack.build_failed',
      slug: draft.slug,
      message: error instanceof Error ? error.message : 'build_failed',
    }));
  }

  const workspaceSession = {
    userId: session.userId,
    email: session.email,
    role: session.role,
    brandId,
    brandName: draft.name,
  } as const;
  const switched = await switchWorkspaceToProvisionedOrg({
    session: workspaceSession, brandId, locationId, factoryIssue, packIssue,
  });
  return switched;
}
