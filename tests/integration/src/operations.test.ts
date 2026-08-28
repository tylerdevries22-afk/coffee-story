import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createSignedInUser, seedBrand, serviceClient, skipUnlessConfigured, sql, userClient,
} from './stack.ts';

type Tenant = { brandId: string; locationId: string };
type Member = {
  memberId: string;
  userId: string;
  accessToken: string;
  client: SupabaseClient;
};
type SuiteFixture = {
  primary: Tenant & { secondLocationId: string };
  foreign: Tenant;
  disabled: Tenant;
  workforceRoleId: string;
  competencyId: string;
  restrictedTemplateId: string;
  simpleTemplateId: string;
  foreignTemplateId: string;
  disabledTemplateId: string;
  eligible: Member;
  competitor: Member;
  secondLocationMember: Member;
  foreignMember: Member;
  disabledMember: Member;
  staleMember: Member;
  expiredMember: Member;
  visiblePrimaryOccurrenceId: string;
  visibleSecondOccurrenceId: string;
  visibleForeignOccurrenceId: string;
  visibleDisabledOccurrenceId: string;
};

const runKey = randomUUID().slice(0, 8);
let fixture: SuiteFixture;

async function createTemplate(input: {
  brandId: string;
  templateKey: string;
  workforceRoleId?: string;
  competencyKey?: string;
  evidenceSteps?: boolean;
}): Promise<string> {
  const template = await sql<{ id: string }>(
    `insert into public.operation_task_templates (
       brand_id, template_key, title, required_role_ids, required_competency_keys, evidence_policy
     ) values ($1, $2, $3, $4::uuid[], $5::text[], $6::jsonb) returning id`,
    [
      input.brandId,
      input.templateKey,
      `Integration ${input.templateKey}`,
      input.workforceRoleId ? [input.workforceRoleId] : [],
      input.competencyKey ? [input.competencyKey] : [],
      JSON.stringify({ note: 'optional', issueCategories: ['supplies'] }),
    ],
  );
  const templateId = template.rows[0]!.id;
  if (input.evidenceSteps) {
    await sql(
      `insert into public.operation_task_steps
       (brand_id, template_id, step_key, title, response_kind, is_required,
        issue_on_failure, constraints, sort_order)
       values
       ($1, $2, 'confirm', 'Confirm work', 'confirm', true, false, '{}'::jsonb, 10),
       ($1, $2, 'condition', 'Condition passes', 'pass_fail', true, true, '{}'::jsonb, 20),
       ($1, $2, 'count', 'Count items', 'number', false, false,
        '{"minimum":1,"maximum":10}'::jsonb, 30),
       ($1, $2, 'note', 'Optional note', 'text', false, false,
        '{"maxLength":20}'::jsonb, 40)`,
      [input.brandId, templateId],
    );
  } else {
    await sql(
      `insert into public.operation_task_steps
       (brand_id, template_id, step_key, title, response_kind, is_required, sort_order)
       values ($1, $2, 'confirm', 'Confirm work', 'confirm', true, 10)`,
      [input.brandId, templateId],
    );
  }
  return templateId;
}

async function createOccurrence(input: {
  brandId: string;
  locationId: string;
  templateId: string;
  label: string;
}): Promise<string> {
  const occurrence = await sql<{ id: string }>(
    `insert into public.operation_occurrences (
       brand_id, location_id, template_id, source, materialization_key,
       template_snapshot, scheduled_for, due_at, grace_minutes, status
     ) values (
       $1, $2, $3, 'manual', $4, app.build_operation_snapshot($3),
       now() - interval '5 minutes', now() + interval '30 minutes', 5, 'due'
     ) returning id`,
    [input.brandId, input.locationId, input.templateId, `${input.label}:${randomUUID()}`],
  );
  return occurrence.rows[0]!.id;
}

async function createMember(input: {
  brandId: string;
  locationIds: readonly string[];
  role?: 'brand_owner' | 'location_manager' | 'staff';
  workforceRoleId?: string;
  assignmentLocationId?: string;
  competencyId?: string;
  competencyExpiresAt?: string;
}): Promise<Member> {
  let memberId = '';
  const signedIn = await createSignedInUser({
    before: async (userId) => {
      const member = await sql<{ id: string }>(
        `insert into public.brand_users (user_id, brand_id, role, location_ids)
         values ($1, $2, $3::app.brand_role, $4::uuid[]) returning id`,
        [userId, input.brandId, input.role ?? 'staff', [...input.locationIds]],
      );
      memberId = member.rows[0]!.id;
      if (input.workforceRoleId) {
        await sql(
          `insert into public.workforce_role_assignments
           (brand_id, brand_user_id, workforce_role_id, location_id)
           values ($1, $2, $3, $4)`,
          [input.brandId, memberId, input.workforceRoleId, input.assignmentLocationId ?? null],
        );
      }
      if (input.competencyId) {
        await sql(
          `insert into public.training_competency_awards
           (brand_id, competency_id, brand_user_id, expires_at)
           values ($1, $2, $3, $4::timestamptz)`,
          [input.brandId, input.competencyId, memberId, input.competencyExpiresAt ?? null],
        );
      }
      for (const locationId of input.locationIds) {
        await sql(
          `insert into public.shifts
           (brand_id, location_id, brand_user_id, starts_at, ends_at, note)
           values ($1, $2, $3, '2026-01-01T00:00:00Z', '2041-01-01T00:00:00Z', 'operations integration')`,
          [input.brandId, locationId, memberId],
        );
      }
    },
  });
  assert.notEqual(memberId, '');
  return {
    memberId,
    userId: signedIn.userId,
    accessToken: signedIn.accessToken,
    client: userClient(signedIn.accessToken),
  };
}

async function expectRpcError(
  request: PromiseLike<{ error: { message: string } | null }>,
  expected: RegExp,
): Promise<void> {
  const result = await request;
  assert.ok(result.error, 'RPC unexpectedly succeeded');
  assert.match(result.error.message, expected);
}

async function visibleOccurrenceIds(
  member: Member,
  occurrenceIds: readonly string[],
): Promise<string[]> {
  const result = await member.client.from('operation_occurrences').select('id').in('id', occurrenceIds);
  assert.equal(result.error, null, result.error?.message);
  return (result.data ?? []).map((row) => row.id).sort();
}

describe('tenant operations against real Supabase', { skip: skipUnlessConfigured }, () => {
  before(async () => {
    const primary = await seedBrand(`operations-primary-${runKey}`);
    const foreign = await seedBrand(`operations-foreign-${runKey}`);
    const disabled = await seedBrand(`operations-disabled-${runKey}`);
    await sql(`update public.brands set operations = true where id in ($1, $2)`, [
      primary.brandId, foreign.brandId,
    ]);
    await sql(`update public.brands set operations = false where id = $1`, [disabled.brandId]);
    const secondLocation = await sql<{ id: string }>(
      `insert into public.locations (brand_id, name, timezone)
       values ($1, 'Second', 'UTC') returning id`,
      [primary.brandId],
    );
    const secondLocationId = secondLocation.rows[0]!.id;
    const workforceRole = await sql<{ id: string }>(
      `insert into public.workforce_roles (brand_id, slug, name)
       values ($1, 'operations-role', 'Operations role') returning id`,
      [primary.brandId],
    );
    const workforceRoleId = workforceRole.rows[0]!.id;
    const competency = await sql<{ id: string }>(
      `insert into public.training_competencies (brand_id, competency_key, title)
       values ($1, 'operations-safety', 'Operations safety') returning id`,
      [primary.brandId],
    );
    const competencyId = competency.rows[0]!.id;
    const restrictedTemplateId = await createTemplate({
      brandId: primary.brandId,
      templateKey: 'restricted-check',
      workforceRoleId,
      competencyKey: 'operations-safety',
      evidenceSteps: true,
    });
    const simpleTemplateId = await createTemplate({
      brandId: primary.brandId, templateKey: 'simple-check',
    });
    const foreignTemplateId = await createTemplate({
      brandId: foreign.brandId, templateKey: 'foreign-check',
    });
    const disabledTemplateId = await createTemplate({
      brandId: disabled.brandId, templateKey: 'disabled-check',
    });
    const eligible = await createMember({
      brandId: primary.brandId,
      locationIds: [primary.locationId],
      workforceRoleId,
      assignmentLocationId: primary.locationId,
      competencyId,
      competencyExpiresAt: '2041-01-01T00:00:00.000Z',
    });
    const competitor = await createMember({
      brandId: primary.brandId,
      locationIds: [primary.locationId],
      workforceRoleId,
      assignmentLocationId: primary.locationId,
      competencyId,
      competencyExpiresAt: '2041-01-01T00:00:00.000Z',
    });
    const secondLocationMember = await createMember({
      brandId: primary.brandId, locationIds: [secondLocationId],
    });
    const foreignMember = await createMember({
      brandId: foreign.brandId, locationIds: [foreign.locationId],
    });
    const disabledMember = await createMember({
      brandId: disabled.brandId, locationIds: [disabled.locationId],
    });
    const staleMember = await createMember({
      brandId: primary.brandId,
      locationIds: [primary.locationId],
      workforceRoleId,
      assignmentLocationId: primary.locationId,
      competencyId,
      competencyExpiresAt: '2041-01-01T00:00:00.000Z',
    });
    const expiredMember = await createMember({
      brandId: primary.brandId,
      locationIds: [primary.locationId],
      workforceRoleId,
      assignmentLocationId: primary.locationId,
      competencyId,
      competencyExpiresAt: '2000-01-01T00:00:00.000Z',
    });
    const visiblePrimaryOccurrenceId = await createOccurrence({
      brandId: primary.brandId,
      locationId: primary.locationId,
      templateId: restrictedTemplateId,
      label: 'visible-primary',
    });
    const visibleSecondOccurrenceId = await createOccurrence({
      brandId: primary.brandId,
      locationId: secondLocationId,
      templateId: simpleTemplateId,
      label: 'visible-second',
    });
    const visibleForeignOccurrenceId = await createOccurrence({
      brandId: foreign.brandId,
      locationId: foreign.locationId,
      templateId: foreignTemplateId,
      label: 'visible-foreign',
    });
    const visibleDisabledOccurrenceId = await createOccurrence({
      brandId: disabled.brandId,
      locationId: disabled.locationId,
      templateId: disabledTemplateId,
      label: 'visible-disabled',
    });
    fixture = {
      primary: { ...primary, secondLocationId },
      foreign,
      disabled,
      workforceRoleId,
      competencyId,
      restrictedTemplateId,
      simpleTemplateId,
      foreignTemplateId,
      disabledTemplateId,
      eligible,
      competitor,
      secondLocationMember,
      foreignMember,
      disabledMember,
      staleMember,
      expiredMember,
      visiblePrimaryOccurrenceId,
      visibleSecondOccurrenceId,
      visibleForeignOccurrenceId,
      visibleDisabledOccurrenceId,
    };
  });

  it('enforces cross-brand, cross-location, and disabled-capability visibility', async () => {
    const occurrenceIds = [
      fixture.visiblePrimaryOccurrenceId,
      fixture.visibleSecondOccurrenceId,
      fixture.visibleForeignOccurrenceId,
      fixture.visibleDisabledOccurrenceId,
    ];
    assert.deepEqual(await visibleOccurrenceIds(fixture.eligible, occurrenceIds), [
      fixture.visiblePrimaryOccurrenceId,
    ]);
    assert.deepEqual(await visibleOccurrenceIds(fixture.secondLocationMember, occurrenceIds), [
      fixture.visibleSecondOccurrenceId,
    ]);
    assert.deepEqual(await visibleOccurrenceIds(fixture.foreignMember, occurrenceIds), [
      fixture.visibleForeignOccurrenceId,
    ]);
    assert.deepEqual(await visibleOccurrenceIds(fixture.disabledMember, occurrenceIds), []);
    await expectRpcError(fixture.disabledMember.client.rpc('claim_operation_occurrence', {
      target_occurrence: fixture.visibleDisabledOccurrenceId,
      target_action_id: randomUUID(),
    }), /operation_occurrence_not_accessible/);
  });

  it('claims and completes once when the same eligible actions are replayed', async () => {
    const occurrenceId = await createOccurrence({
      brandId: fixture.primary.brandId,
      locationId: fixture.primary.locationId,
      templateId: fixture.restrictedTemplateId,
      label: 'idempotent-completion',
    });
    const claimActionId = randomUUID();
    const completeActionId = randomUUID();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const claimed = await fixture.eligible.client.rpc('claim_operation_occurrence', {
        target_occurrence: occurrenceId, target_action_id: claimActionId,
      });
      assert.equal(claimed.error, null, claimed.error?.message);
      assert.equal((claimed.data as { status?: string } | null)?.status, 'claimed');
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const completed = await fixture.eligible.client.rpc('complete_operation_occurrence', {
        target_occurrence: occurrenceId,
        target_action_id: completeActionId,
        target_responses: { confirm: true, condition: true },
        target_note: 'Verified once.',
      });
      assert.equal(completed.error, null, completed.error?.message);
      assert.equal((completed.data as { status?: string } | null)?.status, 'completed');
    }
    const counts = await sql<{
      claimed_events: string;
      completed_events: string;
      responses: string;
      receipts: string;
    }>(
      `select
       (select count(*) from public.operation_occurrence_events
        where occurrence_id = $1 and event_type = 'claimed')::text claimed_events,
       (select count(*) from public.operation_occurrence_events
        where occurrence_id = $1 and event_type = 'completed')::text completed_events,
       (select count(*) from public.operation_step_responses
        where occurrence_id = $1)::text responses,
       (select count(*) from public.operation_action_receipts
        where occurrence_id = $1)::text receipts`,
      [occurrenceId],
    );
    assert.deepEqual(counts.rows[0], {
      claimed_events: '1', completed_events: '1', responses: '2', receipts: '2',
    });
  });

  it('rejects malformed, unknown, mistyped, and unresolved failed evidence', async () => {
    const occurrenceId = await createOccurrence({
      brandId: fixture.primary.brandId,
      locationId: fixture.primary.locationId,
      templateId: fixture.restrictedTemplateId,
      label: 'evidence-validation',
    });
    const claim = await fixture.eligible.client.rpc('claim_operation_occurrence', {
      target_occurrence: occurrenceId, target_action_id: randomUUID(),
    });
    assert.equal(claim.error, null, claim.error?.message);
    await expectRpcError(fixture.eligible.client.rpc('complete_operation_occurrence', {
      target_occurrence: occurrenceId,
      target_action_id: randomUUID(),
      target_responses: [],
      target_note: '',
    }), /operation_responses_invalid/);
    await expectRpcError(fixture.eligible.client.rpc('complete_operation_occurrence', {
      target_occurrence: occurrenceId,
      target_action_id: randomUUID(),
      target_responses: { confirm: true, condition: true, unknown: true },
      target_note: '',
    }), /operation_response_unknown/);
    await expectRpcError(fixture.eligible.client.rpc('complete_operation_occurrence', {
      target_occurrence: occurrenceId,
      target_action_id: randomUUID(),
      target_responses: { confirm: false, condition: true },
      target_note: '',
    }), /operation_response_invalid/);
    await expectRpcError(fixture.eligible.client.rpc('complete_operation_occurrence', {
      target_occurrence: occurrenceId,
      target_action_id: randomUUID(),
      target_responses: { confirm: true, condition: false },
      target_note: '',
    }), /operation_issue_required/);

    const issueActionId = randomUUID();
    const issue = await fixture.eligible.client.rpc('report_operation_issue', {
      target_occurrence: occurrenceId,
      target_action_id: issueActionId,
      target_category: 'supplies',
      target_severity: 'high',
      target_description: 'Replacement required.',
      target_step_key: 'condition',
    });
    assert.equal(issue.error, null, issue.error?.message);
    const completed = await fixture.eligible.client.rpc('complete_operation_occurrence', {
      target_occurrence: occurrenceId,
      target_action_id: randomUUID(),
      target_responses: { confirm: true, condition: false },
      target_note: 'Issue recorded.',
    });
    assert.equal(completed.error, null, completed.error?.message);
    assert.equal((completed.data as { status?: string } | null)?.status, 'completed');
    const stored = await sql<{ issues: string; responses: string }>(
      `select
       (select count(*) from public.operation_issues where occurrence_id = $1)::text issues,
       (select count(*) from public.operation_step_responses where occurrence_id = $1)::text responses`,
      [occurrenceId],
    );
    assert.deepEqual(stored.rows[0], { issues: '1', responses: '2' });
  });

  it('commits failed-step issues and checklist evidence atomically', async () => {
    const occurrenceId = await createOccurrence({
      brandId: fixture.primary.brandId,
      locationId: fixture.primary.locationId,
      templateId: fixture.restrictedTemplateId,
      label: 'atomic-completion',
    });
    const claimed = await fixture.eligible.client.rpc('claim_operation_occurrence', {
      target_occurrence: occurrenceId, target_action_id: randomUUID(),
    });
    assert.equal(claimed.error, null, claimed.error?.message);
    await expectRpcError(fixture.eligible.client.rpc('complete_operation_occurrence', {
      target_occurrence: occurrenceId, target_action_id: randomUUID(),
      target_responses: { confirm: true, condition: false }, target_note: '',
      target_issues: [{ category: 'foreign-category', severity: 'high',
        description: 'Must roll back.', stepKey: 'condition' }],
    }), /operation_issue_invalid/);
    const afterFailure = await sql<{ issues: string; responses: string }>(
      `select
       (select count(*) from public.operation_issues where occurrence_id = $1)::text issues,
       (select count(*) from public.operation_step_responses where occurrence_id = $1)::text responses`,
      [occurrenceId],
    );
    assert.deepEqual(afterFailure.rows[0], { issues: '0', responses: '0' });
    const completed = await fixture.eligible.client.rpc('complete_operation_occurrence', {
      target_occurrence: occurrenceId, target_action_id: randomUUID(),
      target_responses: { confirm: true, condition: false }, target_note: 'Supply issue recorded.',
      target_issues: [{ category: 'supplies', severity: 'high',
        description: 'Replacement required.', stepKey: 'condition' }],
    });
    assert.equal(completed.error, null, completed.error?.message);
    const stored = await sql<{ issues: string; responses: string; events: string }>(
      `select
       (select count(*) from public.operation_issues where occurrence_id = $1)::text issues,
       (select count(*) from public.operation_step_responses where occurrence_id = $1)::text responses,
       (select count(*) from public.operation_occurrence_events
        where occurrence_id = $1 and event_type in ('issue_reported', 'completed'))::text events`,
      [occurrenceId],
    );
    assert.deepEqual(stored.rows[0], { issues: '1', responses: '2', events: '2' });
  });

  it('denies a stale location membership and an expired competency', async () => {
    const staleOccurrenceId = await createOccurrence({
      brandId: fixture.primary.brandId,
      locationId: fixture.primary.locationId,
      templateId: fixture.restrictedTemplateId,
      label: 'stale-membership',
    });
    await sql(`update public.brand_users set location_ids = '{}'::uuid[] where id = $1`, [
      fixture.staleMember.memberId,
    ]);
    assert.deepEqual(await visibleOccurrenceIds(fixture.staleMember, [staleOccurrenceId]), []);
    await expectRpcError(fixture.staleMember.client.rpc('claim_operation_occurrence', {
      target_occurrence: staleOccurrenceId, target_action_id: randomUUID(),
    }), /operation_occurrence_not_accessible/);

    const expiredOccurrenceId = await createOccurrence({
      brandId: fixture.primary.brandId,
      locationId: fixture.primary.locationId,
      templateId: fixture.restrictedTemplateId,
      label: 'expired-competency',
    });
    await expectRpcError(fixture.expiredMember.client.rpc('claim_operation_occurrence', {
      target_occurrence: expiredOccurrenceId, target_action_id: randomUUID(),
    }), /operation_eligibility_required/);
  });

  it('allows exactly one of two eligible workers to win a competing claim', async () => {
    const occurrenceId = await createOccurrence({
      brandId: fixture.primary.brandId,
      locationId: fixture.primary.locationId,
      templateId: fixture.restrictedTemplateId,
      label: 'competing-claim',
    });
    const results = await Promise.all([
      fixture.eligible.client.rpc('claim_operation_occurrence', {
        target_occurrence: occurrenceId, target_action_id: randomUUID(),
      }),
      fixture.competitor.client.rpc('claim_operation_occurrence', {
        target_occurrence: occurrenceId, target_action_id: randomUUID(),
      }),
    ]);
    assert.equal(results.filter((result) => result.error === null).length, 1);
    assert.equal(results.filter((result) => result.error !== null).length, 1);
    assert.match(results.find((result) => result.error)?.error?.message ?? '', /operation_occurrence_not_claimable/);
    const state = await sql<{ claimed_events: string; receipts: string; claimed_by: string }>(
      `select
       (select count(*) from public.operation_occurrence_events
        where occurrence_id = occurrence.id and event_type = 'claimed')::text claimed_events,
       (select count(*) from public.operation_action_receipts
        where occurrence_id = occurrence.id and action_type = 'claim')::text receipts,
       occurrence.claimed_by::text
       from public.operation_occurrences occurrence where occurrence.id = $1`,
      [occurrenceId],
    );
    assert.equal(state.rows[0]!.claimed_events, '1');
    assert.equal(state.rows[0]!.receipts, '1');
    assert.ok([
      fixture.eligible.memberId, fixture.competitor.memberId,
    ].includes(state.rows[0]!.claimed_by));
  });

  it('keeps events and idempotency receipts immutable even to privileged SQL', async () => {
    const occurrenceId = await createOccurrence({
      brandId: fixture.primary.brandId,
      locationId: fixture.primary.locationId,
      templateId: fixture.restrictedTemplateId,
      label: 'immutable-audit',
    });
    const actionId = randomUUID();
    const claimed = await fixture.eligible.client.rpc('claim_operation_occurrence', {
      target_occurrence: occurrenceId, target_action_id: actionId,
    });
    assert.equal(claimed.error, null, claimed.error?.message);
    const audit = await sql<{ event_id: string; receipt_id: string }>(
      `select event.id event_id, receipt.id receipt_id
       from public.operation_occurrence_events event
       join public.operation_action_receipts receipt
         on receipt.occurrence_id = event.occurrence_id and receipt.action_id = $2
       where event.occurrence_id = $1 and event.event_type = 'claimed'`,
      [occurrenceId, actionId],
    );
    const row = audit.rows[0]!;
    await assert.rejects(
      sql(`update public.operation_occurrence_events set reason = 'tampered' where id = $1`, [row.event_id]),
      /operation_audit_record_immutable/,
    );
    await assert.rejects(
      sql(`delete from public.operation_occurrence_events where id = $1`, [row.event_id]),
      /operation_audit_record_immutable/,
    );
    await assert.rejects(
      sql(`update public.operation_action_receipts set action_type = 'complete' where id = $1`, [row.receipt_id]),
      /operation_audit_record_immutable/,
    );
    await assert.rejects(
      sql(`delete from public.operation_action_receipts where id = $1`, [row.receipt_id]),
      /operation_audit_record_immutable/,
    );
  });

  it('materializes and queues an escalation exactly once across overlapping maintenance runs', async () => {
    const schedule = await sql<{ id: string }>(
      `insert into public.operation_schedules (
       brand_id, location_id, template_id, timezone, recurrence_rule,
       local_start_time, due_window_minutes, grace_minutes, active_from,
       active_until, schedule_key, weekdays
       ) values (
       $1, $2, $3, 'UTC', 'daily', '12:00', 30, 0,
       '2040-01-15', '2040-01-15', $4, array[1,2,3,4,5,6,7]::smallint[]
       ) returning id`,
      [
        fixture.primary.brandId,
        fixture.primary.secondLocationId,
        fixture.simpleTemplateId,
        `materializer-${runKey}`,
      ],
    );
    const scheduleId = schedule.rows[0]!.id;
    await sql(
      `insert into public.operation_escalation_rules
       (brand_id, schedule_id, escalation_order, offset_minutes, recipient_role, channels)
       values ($1, $2, 1, 0, 'eligible_staff', array['push']::text[])`,
      [fixture.primary.brandId, scheduleId],
    );
    const maintenance = serviceClient();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await maintenance.rpc('run_operation_maintenance', {
        target_now: '2040-01-15T13:00:00.000Z', target_horizon_hours: 1,
      });
      assert.equal(result.error, null, result.error?.message);
    }
    const materialized = await sql<{
      occurrence_id: string;
      status: string;
      created_events: string;
      overdue_events: string;
      outbox_rows: string;
      recipient_id: string;
    }>(
      `select occurrence.id occurrence_id, occurrence.status::text,
       (select count(*) from public.operation_occurrence_events event
        where event.occurrence_id = occurrence.id and event.event_type = 'created')::text created_events,
       (select count(*) from public.operation_occurrence_events event
        where event.occurrence_id = occurrence.id and event.event_type = 'overdue')::text overdue_events,
       (select count(*) from public.operation_notification_outbox outbox
        where outbox.occurrence_id = occurrence.id)::text outbox_rows,
       (select outbox.recipient_id::text from public.operation_notification_outbox outbox
        where outbox.occurrence_id = occurrence.id limit 1) recipient_id
       from public.operation_occurrences occurrence
       where occurrence.schedule_id = $1
         and occurrence.scheduled_for = '2040-01-15T12:00:00.000Z'::timestamptz`,
      [scheduleId],
    );
    assert.equal(materialized.rows.length, 1);
    assert.deepEqual(materialized.rows[0], {
      occurrence_id: materialized.rows[0]!.occurrence_id,
      status: 'overdue',
      created_events: '1',
      overdue_events: '1',
      outbox_rows: '1',
      recipient_id: fixture.secondLocationMember.memberId,
    });
  });
});
