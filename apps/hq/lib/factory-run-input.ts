/**
 * What `create_platform_onboarding_run` is handed for a new organization.
 *
 * Kept apart from organization-factory-run.ts, which starts a workflow, so the
 * one decision worth testing -- what the factory is told about the business --
 * is reachable without a database or a workflow runtime.
 */
import { factoryTasks } from '@platform/factory';

import type { OrgDraft } from './org-input';

export type OnboardingRunContext = {
  readonly blueprintId: string;
  readonly idempotencyKey: string;
  readonly actorId: string;
};

export function onboardingRunArgs(draft: OrgDraft, context: OnboardingRunContext) {
  return {
    input_blueprint_id: context.blueprintId,
    input_business_name: draft.name,
    input_tenant_slug: draft.slug,
    input_location_name: draft.location?.name ?? `${draft.name} HQ`,
    input_timezone: draft.location?.timezone ?? 'UTC',
    // The research step reads the business's own site before anything else,
    // and this used to be a hard-coded '' -- so a run started from the wizard
    // researched a business with no site even when the operator had one. The
    // RPC stores '' as null, and `website_url` admits only https, which is
    // all parseOrgDraft lets through.
    input_website_url: draft.website ?? '',
    input_idempotency_key: context.idempotencyKey,
    input_created_by: context.actorId,
    input_tasks: factoryTasks(),
  };
}
