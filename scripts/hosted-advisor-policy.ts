import type { AdvisorNotice } from './hosted-migration-model.js';

const AUTHENTICATED_DEFINER_ADVISOR = 'authenticated_security_definer_function_executable';

// These client-callable RPCs intentionally use SECURITY DEFINER to cross RLS
// only after their audited auth.uid(), tenant-membership, or platform-role gate.
// Exact identity arguments make overload or signature drift fail closed.
const APPROVED_AUTHENTICATED_DEFINERS = new Set([
  'public.acknowledge_knowledge_resource(p_resource_id uuid)',
  'public.activate_platform_organization(p_brand_id uuid)',
  'public.caller_brand_ordering_summary(p_brand_id uuid)',
  'public.caller_network_brand_kpis(p_network_id uuid)',
  'public.consume_menu_extraction_budget(p_brand_id uuid)',
  'public.consume_tenant_package_download_budget(p_brand_id uuid, p_scope_key text)',
  'public.create_franchise_network(p_name text, p_slug text)',
  'public.delete_location_if_allowed(p_location_id uuid)',
  'public.enroll_brand_in_network(p_network_id uuid, p_brand_id uuid)',
  'public.export_brand_organization_data(p_brand_id uuid)',
  'public.grant_delegated_access(p_network_id uuid, p_brand_id uuid, p_grantee_user_id uuid, p_scope text[], p_expires_at timestamp with time zone, p_idempotency_key uuid)',
  'public.import_brand_menu(p_brand_id uuid, p_rows jsonb)',
  'public.manage_brand_member(p_brand_id uuid, p_user_id uuid, p_role app.brand_role, p_location_ids uuid[], p_remove boolean)',
  'public.manage_franchise_member(p_network_id uuid, p_user_id uuid, p_role text, p_remove boolean)',
  'public.offboard_brand(p_brand_id uuid, p_reason text)',
  'public.provision_platform_organization(p_idempotency_key uuid, p_name text, p_slug text, p_owner_user_id uuid, p_owner_email text, p_organization_kind text, p_industry_key text, p_blueprint_key text, p_brand_config jsonb, p_location jsonb, p_modules jsonb, p_network_slug text, p_territory jsonb, p_inheritance_policy jsonb, p_fee_bps integer, p_fee_bps_tier2 integer, p_tier_threshold_cents bigint)',
  'public.provision_platform_organization_with_connectors(p_idempotency_key uuid, p_name text, p_slug text, p_owner_user_id uuid, p_owner_email text, p_organization_kind text, p_industry_key text, p_blueprint_key text, p_brand_config jsonb, p_location jsonb, p_modules jsonb, p_network_slug text, p_territory jsonb, p_inheritance_policy jsonb, p_connectors jsonb, p_fee_bps integer, p_fee_bps_tier2 integer, p_tier_threshold_cents bigint)',
  'public.publish_catalog_draft(target_catalog uuid, expected_draft_version integer)',
  'public.receive_integration_tenant_pack(p_brand_id uuid, p_slug text, p_revision integer, p_files jsonb, p_source_repo text, p_source_commit text)',
  'public.respond_to_network_enrollment(p_network_id uuid, p_brand_id uuid, p_accept boolean)',
  'public.restore_brand(p_brand_id uuid)',
  'public.revoke_delegated_access(p_grant_id uuid)',
  'public.suspend_brand(p_brand_id uuid, p_reason text)',
  'public.unenroll_brand_from_network(p_network_id uuid, p_brand_id uuid)',
]);

function advisorObjectKey(notice: AdvisorNotice): string | undefined {
  const { arguments: identityArguments, name, schema } = notice.metadata ?? {};
  return schema && name && identityArguments !== undefined
    ? `${schema}.${name}(${identityArguments})`
    : undefined;
}

export function isApprovedAdvisorNotice(notice: AdvisorNotice): boolean {
  const key = advisorObjectKey(notice);
  return notice.name === AUTHENTICATED_DEFINER_ADVISOR
    && key !== undefined
    && APPROVED_AUTHENTICATED_DEFINERS.has(key);
}
