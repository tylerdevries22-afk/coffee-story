# Organization onboarding architecture

Status: accepted · 2026-09-04

## Decision

Use a shared-schema control plane with tenant-scoped rows and row-level
security. Provisioning remains one idempotent transaction that creates the
organization, initial location, module entitlements, connector intents, and
five application releases. Runtime apps read the same published tenant
configuration and activity stream.

Tenant folders are build inputs, not a second database. They contain brand,
media, module, and release manifests for deterministic app builds. Database
records remain the source of truth for membership, live operations, and
provisioning state.

## Why this model

| Candidate | Result | Reason |
| --- | --- | --- |
| JSON configuration only | Rejected | Flexible, but weak constraints and difficult fleet-wide queries. |
| Schema per tenant | Rejected | Migration and connection-pool overhead grows with every franchise. |
| Database per tenant | Reserved | Useful for regulated isolation, but too costly as the default. |
| Fully event-sourced state | Rejected | Adds replay and projection complexity to ordinary CRUD. |
| Shared schema + RLS + ledgers | Chosen | Strong isolation, simple migrations, efficient reporting, and auditable releases. |

Append-only ledgers are used only where history matters: provisioning events,
module releases, connector state changes, and the cross-app activity board.
Current organization state stays relational and queryable.

## Boundaries

- Every tenant-owned row carries `organization_id`; location-owned rows also
  carry `location_id`.
- Browser clients use the publishable key and RLS. Server mutations validate
  inputs and membership again; service credentials never enter a client bundle.
- Module eligibility is a canonical registry filtered by industry. Selection
  expands dependencies before persistence, so the UI and installed set agree.
- Connector catalog records are global and immutable by key. Organization
  connector records hold tenant-owned intent, credentials references, and
  health state.
- The activity board consumes a location-scoped event stream used by Operator,
  Display, and HQ preview; it does not scrape app-specific state.
- Five app releases reference one tenant artifact digest. A release cannot mix
  manifests from different organizations.

## Provisioning transaction

1. Validate the industry, model, owner, location, modules, and connector keys.
2. Claim the idempotency key for the owner.
3. Create the organization and membership.
4. Create the initial location when the model requires one.
5. Resolve module dependencies and write entitlements.
6. Create connector setup intents without credentials.
7. Create a release record for HQ, Customer, Operator, Kiosk, and Display.
8. Emit one provisioning event and return the organization identifier.

Retries return the original result. Partial organizations are never exposed.

## Scale and operations

- Index tenant ID first on operational hot paths; add location and time second.
- Use realtime only for bounded location channels. Recover missed events from
  the ordered activity ledger.
- Keep module and connector keys stable; evolve metadata additively.
- Use direct database connections for migrations and transaction-pooler
  connections for serverless runtime workloads.
- Promote schema, tenant artifacts, and app releases through one release gate.

## Security verification

Each public mutation needs input, authorization, idempotency, and negative RLS
tests. CI must run dependency audit, SQL lint/advisors, tenant-bundle isolation,
cross-app release consistency, and an unauthenticated access check.
