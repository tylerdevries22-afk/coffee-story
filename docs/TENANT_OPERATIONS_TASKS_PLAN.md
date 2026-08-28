# Tenant operations tasks: bathroom-cleaning audit and integration plan

## Decision record

Bathroom cleaning must not become a platform-wide coffee-shop assumption. It is
the first Coffee Story configuration of a generic, tenant-owned operations task
system. The agreed product choices are:

- generic recurring and triggered tasks;
- brand defaults with location overrides;
- brand-authored franchise templates, with locations choosing local schedules
  and assignees;
- assignment to a shift role, followed by an eligible staff member claiming the
  occurrence;
- a configurable overdue escalation ladder;
- checklist responses, authenticated identity, timestamp, notes, and issue
  reporting as completion evidence (no photo requirement in the first release);
- training as a reusable skill module and a hard eligibility gate;
- operational-accountability reporting with tenant-configurable retention;
- staff and management visibility only;
- operator app execution and HQ configuration/reporting;
- a generic foundation piloted by Coffee Story; and
- fully editable location checklists, even when inherited from a brand template.

The last choice is intentionally permissive. The system must preserve provenance
and audit changes so HQ can distinguish the franchise standard from a local
variant, but it must not silently restore or lock centrally-authored steps.

## Executive finding

The repository already has roughly one third of the required foundation. It has
tenant-scoped shifts, simple recurring crew-task templates, one completion per
task/location/day, a Crew screen, workforce roles, a calendar with a task
category, versioned tenant training, notification transports, tenant onboarding,
and tenant-aware analytics. Bathroom cleaning could be faked today as a `daily`
crew task, but that would not satisfy scheduled cleaning: the current model has
no occurrence or due window, role claim, multi-step evidence, training gate,
overdue state, escalation, immutable correction history, or useful reporting.

The correct integration is to evolve the existing crew-task concept into a
generic operations domain. Do not add a parallel `bathroom_cleanings` table and
do not use `calendar_entries` as the source of truth. The operations domain owns
templates, schedules, generated occurrences, claims, checklist evidence, issues,
and audit history; calendar and notifications are projections of that state.

## Repository-wide placement audit

### `packages/schema` and `supabase/migrations`: authoritative model

The existing `shifts`, `crew_tasks`, and `crew_task_completions` tables are the
closest fit. They correctly carry `brand_id`; location-null tasks already mean a
brand default, while a location-bound row acts as a local task. Their limitations
are structural:

- recurrence is only `opening | closing | daily | weekly`;
- completion uniqueness is `(task_id, location_id, service_date)`, preventing
  multiple restroom rounds in one day;
- a task is a single checkbox rather than a checklist definition;
- a completion can be deleted, so the historical record is not immutable;
- there is no due time, grace period, time zone policy, trigger, claim, role,
  eligibility, exception, note, issue, or escalation state;
- location staff can remove completions and the shift write policy is broader
  than the manager-owned scheduling model needs; and
- tenant identity is repeated but not protected everywhere by composite foreign
  keys, leaving more correctness to application code than newer calendar tables
  do.

The later calendar/workforce migration adds useful primitives:
`workforce_roles`, role assignments, task-capable calendar categories, and
tenant-safe composite foreign keys. These should be referenced, not duplicated.
`calendar_entries` is appropriate for a staff calendar projection, but is too
generic to enforce task workflow invariants and explicitly treats authoritative
domain records as projections.

Add the operations tables in a new forward-only migration and regenerate
`packages/schema/src/generated.ts`. Promote handwritten row types in
`packages/schema/src/types.ts` to the new contracts, leaving compatibility
aliases only during migration.

### `packages/domain`: portable rules

This package is the correct home for pure, framework-free logic:

- resolving brand templates plus full location overrides;
- recurrence validation and time-zone-aware occurrence windows;
- occurrence state (`upcoming`, `due`, `claimed`, `completed`, `overdue`,
  `waived`, `cancelled`);
- claim eligibility from workforce roles and training competencies;
- checklist validation and completion readiness;
- escalation thresholds and recipient selection inputs;
- operational metrics; and
- retention-policy validation.

The existing operator-only checklist helpers should move here rather than grow
another duplicate. Existing time-zone helpers can be reused, but occurrence
generation must use the location's IANA time zone and explicitly handle daylight
saving gaps/overlaps.

The versioned training manifest already supplies `skills`, `safety`, and
`operations` tracks. Extend the portable training contract with stable
competency keys, renewal/expiry metadata, and lesson-to-competency awards.
Completion records must reference a published release/version so later edits do
not rewrite historical qualification.

### `packages/data`: RLS-scoped reads and realtime

The existing crew adapter fetches roster and checklist rows separately and
polls from the operator screen. Replace its checklist path with operations
adapters that:

- fetch the location's occurrence queue for a bounded window;
- fetch a detail view with the resolved checklist snapshot;
- claim, complete, waive, and report issues through typed RPC/API boundaries;
- subscribe to a payload-safe `operations_change_signals` table and reconcile;
- expose manager history and report reads under RLS; and
- always scope by both `brand_id` and `location_id` in application queries even
  though RLS remains the security boundary.

Writes with workflow invariants should not be raw table inserts/deletes from the
app. Use database functions for safe staff actions or trusted, idempotent API
routes for actions that also enqueue notifications.

### `packages/engine`: orchestration, jobs, and escalation

The engine should own server-side operations services:

- idempotent occurrence materialization from schedules;
- ad hoc/event-triggered occurrence creation;
- atomic claims with an expiry/release policy;
- completion validation against the snapshotted checklist and competency;
- overdue transitions and escalation-event creation;
- notification recipient resolution;
- retention/anonymization jobs; and
- aggregate report queries or rollups.

Extend the existing notification system with tenant-copy-driven operational
templates rather than bathroom-specific strings. Candidate events are
`task_due`, `task_overdue_staff`, `task_overdue_manager`,
`task_overdue_brand_owner`, `task_issue_reported`, and `task_reassigned`.
Persist an outbox/delivery record with an idempotency key; direct sends from a
cron loop are not safe enough for escalation.

Extend `scripts/run-jobs.ts` only as a thin scheduler entry point. It should call
engine functions to materialize a horizon of occurrences, mark overdue work,
claim outbox deliveries, and apply retention. The database must make every step
safe under overlapping cron executions.

### `apps/operator`: primary staff experience

The Crew tab is the immediate home because it already combines who is on shift
with what remains to be done. Evolve it into an operations queue rather than
adding a bathroom tab:

1. **Crew overview:** due now, coming soon, overdue, claimed by me, and issues;
   retain roster context and show shift-role coverage.
2. **Task occurrence detail:** instructions, due window, estimated duration,
   eligibility/training state, claim action, checklist responses, optional note,
   issue reporting, and final confirmation.
3. **My work:** the signed-in worker's claimed and upcoming occurrences.
4. **Manager controls:** assign/reassign, waive with reason, create an ad hoc
   task, and resolve a reported issue.
5. **Offline posture:** cache occurrences and checklist snapshots; queue claim
   and completion intents with idempotency keys; reconcile conflicts visibly.

The existing one-tap optimistic toggle must be retired for scheduled operations.
Completion is a state transition, not a reversible delete. Corrections should be
new audit events with a reason. Realtime should replace minute polling for task
changes, while a local injected clock updates due/overdue presentation.

The Calendar surface should project task occurrences and link to their detail;
it should not create independent calendar task records. Training screens should
show awarded/expired competencies and deep-link an ineligible worker to the
required lesson. Notifications should deep-link to the occurrence.

Because this is an Expo SDK 54 app, implementation must use the versioned SDK 54
APIs and retain the repository's Fabric animation rule. No customer, kiosk, or
display surface needs operational data in the initial release.

### `apps/hq`: franchise configuration and reporting

HQ needs an **Operations** workspace in its console navigation with:

- template library: title, instructions, estimated duration, checklist steps,
  required role(s), competency keys, evidence policy, and issue categories;
- schedule builder: locations, recurrence/time windows, local time zone,
  grace/escalation thresholds, start/end dates, and blackout rules;
- location override editor: clone the effective brand template into a fully
  editable local revision, show provenance/diff, and allow reverting to brand;
- live operations: due, claimed, overdue, issues, coverage gaps, and manager
  actions;
- history/audit: occurrence timeline, checklist response snapshot, actor,
  corrections, waivers, and escalation deliveries;
- reporting: on-time completion rate, overdue rate/duration, claim latency,
  issue rate, waiver rate, and breakdowns by brand/location/template/shift;
- retention settings; and
- competency mapping into the existing Training editor.

Brand owners create defaults and can inspect all locations. Location managers
can edit schedules and complete local checklist overrides for assigned
locations. Platform administrators can support tenants but must use audited
service paths. Staff cannot author templates or schedules.

Operations analytics belongs beside the existing operations/training analytics,
but the first reporting screen should read domain-owned measures rather than
infer compliance from calendar events.

### Tenant configuration and onboarding

Tenant capability must be explicit and data-driven. Add an `operations` feature
capability to the brand configuration contract, with sub-capabilities such as
`tasks`, `trainingGates`, `escalations`, and `issueReporting`. Absence/false means
no Operations navigation, seeded templates, jobs, notifications, or analytics
for that tenant.

Do not add `bathroomCleaning: true` to the universal template. Instead add an
optional tenant operations seed artifact, for example
`tenants/<slug>/operations.json`, and document it in `tenants/_template` without
shipping industry-specific tasks. `scripts/onboard.ts` should validate and
idempotently seed only an enabled tenant's generic operations definitions.

Coffee Story's artifact can define a restroom program. A construction tenant
can enable the same engine with safety inspections and equipment checks, or omit
operations entirely. Training competencies referenced by a task must resolve in
that tenant's published training or onboarding must fail with an actionable
error.

### Surfaces that should not receive the feature

- **Customer:** no internal task, schedule, employee, or cleaning-log data.
- **Kiosk:** no task data; a future issue-reporting workflow would use a narrow
  trusted endpoint rather than operations-table reads.
- **Display:** no task data or signal subscription.
- **Customer notification screen:** no operational escalation messages.

Keeping these surfaces out is both a product choice and a security boundary.

### Tests, observability, and documentation

Extend schema invariant tests for tenant composite keys, RLS role matrices,
immutable event history, competency enforcement, cross-location denial, and
idempotent occurrence/notification creation. Add pure domain tests for time
zones, daylight saving changes, recurrence, overrides, state transitions,
escalations, retention, and metrics. Add data-adapter tests for explicit tenant
filters, reconciliation, and cleanup. Add operator tests for offline conflicts
and HQ tests for authorization and override diffs. Add integration tests proving
that two tenants with identically named templates cannot see or mutate each
other and that a tenant with operations disabled receives no rows or navigation.

Emit tenant-scoped, non-sensitive analytics for occurrence generated, claimed,
completed, overdue, waived, issue reported/resolved, escalation attempted/sent,
and offline reconciliation failed. Never put free-text notes or checklist
answers into analytics payloads. Update architecture, runbook, production setup,
tenant onboarding, and training automation documentation when implementation
lands.

## Proposed data model

Names are deliberately generic. Every relationship that repeats tenant identity
must use composite foreign keys so cross-tenant references fail in PostgreSQL,
not merely in UI code.

1. **`operation_task_templates`** — `id`, `brand_id`, optional `location_id`,
   stable `key`, revision, title/instructions, duration, active state, and
   provenance (`brand_template_id`, `supersedes_id`). A location override is a
   complete editable revision, matching the selected full-local-edit policy.
2. **`operation_task_steps`** — ordered versioned step definitions with response
   kind (`confirm`, `pass_fail`, `number`, `text`), requirement, bounds, and
   issue-on-failure behavior.
3. **`operation_task_requirements`** — required workforce roles and competency
   keys. Keep roles and competencies separate because one answers assignment
   and the other answers qualification.
4. **`operation_schedules`** — brand/location, effective template revision,
   IANA time zone, recurrence rule, due-window duration, grace period,
   activation dates, and enabled state.
5. **`operation_escalation_rules`** — ordered offsets and recipient roles/channels
   per schedule or brand default.
6. **`operation_occurrences`** — immutable schedule/template snapshots plus
   `scheduled_for`, `due_at`, state, source (`schedule`, `manual`, `event`),
   idempotency key, claimant, claim time/expiry, and completion time. Unique on a
   tenant-safe materialization key.
7. **`operation_occurrence_events`** — append-only state and correction history
   with actor, reason, metadata, and time. A trigger/RPC enforces transitions.
8. **`operation_step_responses`** — response snapshot per occurrence/step,
   authenticated actor, time, and normalized value. Notes are operational data,
   never analytics dimensions.
9. **`operation_issues`** — issue category, severity, description, status,
   reporter, assignee, resolution, and timestamps.
10. **`training_competencies` / `training_competency_awards`** — tenant-stable
    competency definitions and worker awards tied to release/lesson, score,
    awarded time, expiry, and manager verification if later enabled.
11. **`operation_notification_outbox`** — occurrence/escalation key, recipient,
    channel, attempt state, and delivery timestamps.
12. **`operation_retention_policies`** — brand policy with constrained retention
    periods for evidence, issues, and audit identity. Prefer anonymizing actor
    identity after the configured period while retaining aggregate facts.

Avoid storing future occurrences indefinitely. Materialize a short rolling
horizon and retain completed occurrences according to tenant policy. Snapshot
the effective template into each occurrence so local edits affect only future
work.

## Coffee Story pilot configuration

The pilot should be authored as tenant seed data, not migration literals:

- capability: operations tasks, training gates, escalations, issue reporting;
- template key: `restroom-routine`;
- example steps: post temporary service sign when appropriate, restock approved
  supplies, clean and inspect tenant-defined fixtures/surfaces, inspect floor,
  perform final condition check, and report defects or supply shortages;
- role: tenant-defined floor/operations role;
- competency: a Coffee Story sanitation skill connected to Safety and Skills
  lessons;
- schedule: location-local recurring windows selected by the manager;
- evidence: all required confirmations, staff identity/time, optional note, and
  issue creation for failed checks; and
- escalation: on-duty eligible role, then location manager, then brand owner at
  tenant-configured thresholds.

Exact procedures, chemicals, protective equipment, frequency, and regulatory
claims must be authored and approved by the tenant; they should not be invented
by platform code or generated without verified sources.

## Delivery plan and gates

### Phase 0 — contract and threat model

Finalize terminology, state machine, recurrence subset, retention bounds,
manager permissions, offline conflict rules, and notification channels. Produce
RLS and abuse-case matrices before migration code. Decide whether full local
editing creates a permanent fork or can opt back into future brand revisions.

**Exit gate:** reviewed schema/state diagrams, RLS matrix, data classification,
and acceptance scenarios for a cafe, a construction tenant, and a tenant with
operations disabled.

### Phase 1 — schema and portable domain

Create tenant-safe tables, state/event functions, generated types, and pure
domain modules. Add compatibility reads for existing `crew_tasks`; do not dual
write indefinitely. Backfill each existing task into one generic template and
schedule, preserving old completion records as legacy history.

**Exit gate:** schema invariants and domain suites pass, cross-tenant mutation is
denied, duplicate materialization is impossible, and migration rollback/recovery
is documented.

### Phase 2 — engine, jobs, and data adapters

Implement horizon materialization, triggered creation, atomic claim/complete
RPCs, competency checks, escalation/outbox workers, retention, realtime signals,
and typed data adapters. Add clocks/IDs as injected dependencies for tests.

**Exit gate:** racing workers do not duplicate occurrences or messages;
daylight-saving and overnight shifts behave correctly; replayed mobile writes
resolve idempotently.

### Phase 3 — HQ franchise controls

Build Operations navigation, brand templates, schedule builder, full location
override editing and diff, competency mapping, live status, history, reporting,
and retention settings. Enforce owner/manager scope server-side.

**Exit gate:** an owner can publish a default, a manager can fully customize one
location without changing another, and a disabled tenant sees no operations UI.

### Phase 4 — operator execution

Replace one-tap crew checklists with queue/detail/claim/complete flows, manager
actions, training deep links, calendar projections, notifications, realtime, and
offline reconciliation. Preserve the useful roster portion of Crew.

**Exit gate:** eligible staff can complete online/offline; ineligible staff are
blocked and routed to training; overdue escalation and corrections are visible;
accessibility and SDK 54 device checks pass.

### Phase 5 — Coffee Story pilot and rollout

Add the Coffee Story operations artifact and sanitation training content, seed a
non-food construction fixture, and keep the generic tenant template empty.
Pilot at one location, tune timings and copy, then expand by explicit location
enablement.

**Exit gate:** Coffee Story reports useful on-time/overdue metrics; construction
fixtures contain no bathroom assumptions; disabled-tenant and cross-tenant tests
pass; support/retention runbooks are approved.

### Phase 6 — legacy retirement

After all active tenants migrate, remove old checklist reads/writes, legacy
operator helpers, obsolete enums/types, and old policies/tables in a separately
reviewed migration. Preserve exported historical records for the configured
retention window.

## Principal risks and mitigations

- **Industry leakage:** bathroom strings in shared code would surface in other
  franchises. Keep generic code/copy and tenant-authored seed artifacts.
- **Tenant escape:** IDs supplied by clients could cross-link records. Use
  `brand_id` everywhere, composite foreign keys, RLS, server authorization, and
  explicit application filters.
- **Schedule errors:** UTC-day queries and naive recurrence break around local
  midnight and daylight saving. Generate using location IANA zones and test
  gaps, overlaps, overnight shifts, and location changes.
- **False compliance:** reversible deletion and mutable definitions can alter
  history. Snapshot definitions, append events/corrections, and prohibit hard
  deletion of occurrences/evidence through clients.
- **Unqualified work:** role assignment alone is not training. Enforce current
  competency in the atomic claim/complete path, not only in UI.
- **Notification storms:** repeated workers can resend escalations. Use an
  idempotent outbox, ordered escalation keys, quiet-hour/channel policy, and
  delivery observability.
- **Manager override drift:** full local editing can diverge from franchise
  standards. Show provenance/diffs and revision history without violating the
  decision to permit full editing.
- **Privacy and labor concerns:** staff performance data and notes are sensitive.
  Minimize evidence, restrict reports, configure retention, audit management
  access, and avoid individual ranking as the primary metric.
- **Offline double claims:** multiple devices may claim the same work. Treat the
  server as authoritative, use conditional transitions and idempotency keys, and
  surface lost claims rather than silently overwriting them.

## Definition of done

The feature is complete only when bathroom cleaning exists solely as Coffee
Story tenant content; other industries can configure their own operations or
disable the capability; all records and relations are tenant/location scoped;
brand defaults and fully editable location variants work; role claim and
training eligibility are enforced server-side; scheduled and triggered work,
evidence, issues, escalation, retention, offline behavior, reporting, and audit
history are implemented; and customer/public surfaces cannot read operational
data.
