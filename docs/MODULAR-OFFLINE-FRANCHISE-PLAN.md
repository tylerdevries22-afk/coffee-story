# Modular Offline and Franchise Readiness Plan

## Executive decision

Adopt a hybrid module architecture:

- Version-controlled tenant manifests define reproducible defaults.
- Database installations control runtime entitlements and configuration.
- Shared app infrastructure owns tenancy, security, synchronization, and offline resilience.
- Optional modules own business capabilities such as commerce, projects, training, and local printing.
- Coffee Story and Stillpoint Builders are the production pilots; Demo Roastery remains the cross-industry test fixture.
- HQ and operator use shared multi-tenant binaries. Customer and kiosk binaries are created only for tenants that enable those surfaces.
- Stillpoint migrates through a staged dual-shell approach: its current application stays live while reusable project capabilities move behind versioned platform APIs.

The offline solution is layered rather than dependent on one fallback:

1. Managed local edge network with UPS and cellular failover.
2. Durable device-local order and print queues.
3. Provider-owned Square and Stripe offline-payment queues.
4. Shared LAN printer through a local print gateway.
5. A pre-paired Bluetooth emergency printer for complete access-point failure.
6. Cash/manual tender and deferred digital receipts as documented last-resort procedures.

## Audit baseline

- There is no authoritative module registry. Current "modules" are split among `brand.json` flags, operations configuration, training tracks, routes, tables, and generated artifacts.
- `brand.json` mixes identity, theme, restaurant configuration, loyalty, fulfillment, kiosk, tax, fees, and feature flags. This prevents a construction tenant from being valid without restaurant-shaped data.
- Stillpoint is currently a themed demo tenant and cannot pass onboarding/release requirements without irrelevant customer and kiosk metadata.
- HQ and native navigation expose many capabilities regardless of tenant enablement. Hiding links alone would not protect APIs, jobs, or data.
- Offline state currently uses several unrelated AsyncStorage/SecureStore queues and caches. There is no shared migration, encryption, conflict, retention, observability, or tenant-switch policy.
- Current printing is an operator-specific AirPrint order-ticket implementation. It lacks module entitlement, provider-neutral payment evidence, direct Bluetooth transport, and final-versus-pending receipt semantics.
- The production gate is currently red: token audit finds raw HQ colors; HQ lint has a precision warning; HQ typecheck has unresolved app-wall imports; 2 of 458 HQ tests fail; hosted Supabase integration tests are skipped.
- All tenant release approvals are pending. Demo Roastery and Stillpoint additionally lack EAS IDs that the current gate incorrectly requires for every tenant.
- Numerous hand-authored files exceed the 200-line policy, including the order engine, app screens, operator stores, HQ content actions, and onboarding.
- The status page is not connected to monitoring, kiosk payments remain simulated, and content publishing is blocked by bootstrap prerequisites.

Phase zero preserves all existing uncommitted work, repairs these baseline failures, and makes the root verification gate green before module migration begins.

## Target architecture

### Module system

Create three boundaries:

- `packages/module-kit`: module contracts, dependency resolution, schemas, activation rules, route guards, and capability snapshots.
- `packages/offline`: shared offline infrastructure used by every app; it is not optional and cannot be disabled by a tenant.
- `packages/modules/*`: optional business modules, including local printing and construction projects.

Each module definition declares a stable key and semantic version, dependencies, supported app surfaces, configuration schema and migration version, permissions, owned routes/jobs/events, analytics, offline contribution, release prerequisites, and incompatible modules.

The resolver returns one immutable `ResolvedCapabilitySnapshot` containing tenant, site, module versions, permissions, configuration revision, expiry, and signature. Apps cache the last valid snapshot but fail closed for sensitive actions if it expires.

Module activation uses `draft -> validating -> active -> suspended -> disabled/error`. Activation is atomic and validates dependencies, configuration, migrations, provider credentials, app availability, and hardware requirements before exposing routes.

### Tenant and franchise model

Keep the existing `brands` row as the physical tenant record during v1 to avoid rewriting every foreign key. Add franchise networks and memberships, network-to-tenant relationships, module installations and versions, site-level permitted overrides, immutable module/configuration change events, and time-limited delegated-access grants.

Configuration precedence is:

`platform defaults -> industry blueprint -> network defaults/locks -> tenant configuration -> permitted site/device overrides`

Franchisors receive aggregate KPIs and standards-compliance reporting by default. Raw orders, customers, staff, payment evidence, and projects remain tenant-isolated under RLS. Detailed access requires an explicit, expiring, audited delegation.

### Tenant artifacts

Standardize each tenant as:

```text
tenants/<slug>/
  brand.json
  modules.json
  modules/<module-key>/*
  release.json
```

- `brand.json` retains identity, theme, public copy, and app identifiers only.
- `modules.json` lists enabled modules, versions, configuration artifacts, and enabled app surfaces.
- Module-specific files move under their owning module instead of accumulating at the tenant root.
- `release.json` lists only enabled release targets; construction tenants no longer require customer/kiosk EAS projects unless those surfaces are enabled.
- Industry blueprints provide recommended bundles and vocabulary, not hard-coded UI behavior.
- Legacy feature flags are backfilled into module installations, dual-read for one release, compared through telemetry, and removed after rollback validation.

### Initial module catalog

- Always-on core: tenancy, RBAC/audit, franchise hierarchy, configuration, devices, storage, integrations, observability, and offline core.
- Commerce: catalog, ordering, fulfillment, payments, prep/display, catering, and delivery.
- Growth: loyalty, stored value, referrals, campaigns, and drops.
- Workforce: operations, schedules, training, competencies, and shifts.
- Construction v1: projects, workflow stages, tasks/dependencies, assignments, schedules, field documents/photos, RFIs, and approvals.
- Local printing: generic printable documents, printer profiles, transports, routing, retries, and audit history.

Stillpoint v1 deliberately excludes CRM, estimates, marketing, hiring, messaging, private Brain workflows, and the finance control plane. Its current app remains live. Platform APIs gradually take ownership of project workflows and field records after reconciliation; JobTread retains explicitly mapped job/financial master fields, and QuickBooks remains outside the project module.

### Shared offline core

Implement one versioned local database per tenant/site/device context with encrypted sensitive payloads and SecureStore-held device keys, an append-only business outbox, cached capability/configuration snapshots, idempotency keys and monotonic revisions, bounded exponential retry, module-owned conflict policies, retention and secure cleanup, and connectivity state that distinguishes internet, provider, LAN, edge gateway, reader, and printer health.

Never store PAN, CVV, magnetic-track data, or provider encryption material. Square and Stripe SDKs remain the sole owners of card data and their protected offline queues.

Block tenant switching, payment-provider deauthorization, database migration, and application upgrades while unsettled provider payments exist unless an audited disaster override is used.

The formal offline SLA applies to attended operator and kiosk sales devices:

- Create orders, take permitted offline payments, print, and inspect pending work.
- Devices work independently if the access point fails; they do not exchange new orders until connectivity returns.
- Customer, display, and HQ receive cached/read-only or explicit unavailable states but no offline-write guarantee.
- HQ never queues sensitive administrative writes offline.

### Payments and receipt data flow

Define a provider-neutral `PaymentAdapter` with authorization, reader discovery, payment collection, offline status, stored amount/count, reconciliation, and safe receipt-evidence methods.

Implement both launch adapters:

- Square Mobile Payments SDK using supported Bluetooth reader hardware and `autoDetect`; offline operation remains gated by Square seller opt-in, supported hardware, recent online connection, risk limits, and controlled production testing. See [Square offline requirements](https://developer.squareup.com/docs/mobile-payments-sdk/ios/offline-payments).
- Stripe Terminal React Native SDK using Stripe Reader M2 for access-point-independent operation. Internet readers may be supported online but are not certified for total AP loss. See [Stripe offline requirements](https://docs.stripe.com/terminal/features/operate-offline/collect-card-payments).

Square payments are allowed only on attended operator/kiosk installations because its embedded SDK prohibits unattended use.

```text
Local order
  -> provider payment attempt with unique local ID
  -> provider returns online result or securely queued offline result
  -> platform stores only sanitized payment evidence
  -> immutable printable-document snapshot
  -> durable print outbox
  -> edge/LAN printer or Bluetooth fallback
  -> provider reconnects and forwards payment
  -> webhook + device reconciliation maps local ID to provider ID
  -> order/payment state becomes settled or exception
```

An offline printout is labeled `PAYMENT ACCEPTED OFFLINE - PROCESSING PENDING`, includes the local correlation ID and only provider-approved card brand/last-four fields, and never claims final settlement. After reconciliation, the customer can receive or reprint the final provider-backed receipt. A later decline creates a visible financial exception and cannot silently leave the order marked paid.

### Local-printing module

Expose versioned `PrintableDocument`, `PrintProfile`, `PrintRoute`, `PrinterTransport`, and `PrintJob` contracts. Terminal states are queued, delivered, confirmed, uncertain, failed, or cancelled.

- Snapshot all printable data when a job is created so printing never requires a server lookup.
- Use a stable print-job ID through device, edge gateway, and printer spooler.
- Treat timeout-after-send as `uncertain`, not failed; manual reprints carry a duplicate/reprint marker.
- Route by site, document type, and priority.
- Retain minimum audit metadata but purge receipt PII according to tenant policy.
- Display paper-out, cover-open, unreachable, stale queue, and fallback status locally.

Hardware certification baseline:

- iPad first, using custom Expo development/App Store builds on the repository's pinned SDK 54, not Expo Go.
- Primary shared printer: Star mC-Print3 MCP31LB over LAN through the edge gateway.
- Emergency printer: Star SM-S230i-class Bluetooth mobile printer pre-paired with a nominated sales iPad.
- Native transport: StarXpand adapter, which supports LAN and Bluetooth with printer status and spool states. See [StarXpand documentation](https://star-m.jp/products/s_print/sdk/starxpand/manual/en/index.html).
- Edge kit: managed router/AP, isolated POS VLAN, cellular WAN failover, UPS, monitored print gateway, signed updates, pinned local TLS identity, device-scoped credentials, replay protection, and no inbound public port.
- The edge print gateway is only an idempotent transport/spooler; business offline state remains in the main app.

## Implementation sequence

1. **Restore a trustworthy baseline**
   - Record and preserve dirty changes.
   - Repair current audit/lint/typecheck/HQ test failures.
   - Provision a hosted Supabase integration-test branch.
   - Split all non-exempt files over 200 lines, prioritizing order/payment engines, stores, screens, onboarding, and HQ actions.
   - Replace the status stub with real dependency health and incident reporting.

2. **Introduce tenancy and module foundations**
   - Add franchise/module migrations, RLS, aggregate-only network views, delegated access, and audit events.
   - Build the registry, resolver, activation lifecycle, and signed snapshots.
   - Make server actions, APIs, jobs, navigation, and data fetching enforce the same resolved capabilities.
   - Convert onboarding to a read-only validation/plan step followed by an explicit apply step.
   - Unblock content bootstrap through module-owned seed operations.

3. **Migrate current capabilities**
   - Move restaurant configuration into commerce/growth/workforce modules.
   - Convert operations to a true optional module.
   - Rename training "modules" to tracks/lessons to avoid collision with capability modules.
   - Add coffee-shop and construction blueprints.
   - Backfill legacy flags, run dual-read comparison, then remove legacy ownership.

4. **Extract Stillpoint projects**
   - Define a versioned project API and field-ownership map.
   - Import organizations, projects, memberships, workflows, tasks, schedules, documents/photos, RFIs, and approvals through idempotent migration jobs.
   - Run record counts, checksums, permission comparisons, and bidirectional shadow reconciliation.
   - Cut over one capability at a time; preserve a rollback cursor and keep the existing Stillpoint UI live until each capability passes pilot acceptance.

5. **Build offline payments and local printing**
   - Consolidate existing order, operations, analytics, cache, and print queues onto the shared offline core.
   - Add Square and Stripe native adapters, risk controls, reader lifecycle, pending-payment UI, and reconciliation workers.
   - Replace the operator-specific AirPrint implementation with the generic local-printing module while retaining an AirPrint compatibility adapter.
   - Add edge-gateway and Bluetooth transports, diagnostics, test prints, failover controls, and support runbooks.

6. **Pilot and general availability**
   - Demo Roastery continuously exercises restaurant and non-restaurant combinations as a fixture.
   - Coffee Story pilots commerce, both payment providers, edge printing, and Bluetooth failover.
   - Stillpoint pilots project isolation, staged dual-shell migration, and franchise permissions.
   - Roll out by internal devices, one site, one tenant, both pilot tenants, then franchise GA.
   - Retain module-activation and legacy-flag rollback switches until two stable releases complete.

## Verification and release gates

Automated coverage must include:

- Every public module resolver, adapter, migration, and sync function.
- Invalid manifests, missing dependencies, cycles, incompatible versions, and unauthorized activation.
- RLS attempts across tenants, sites, franchisees, and expired delegations.
- Aggregate franchisor access with raw tenant records denied.
- Disabled-module denial in app routes, APIs, jobs, and navigation.
- Manifest/DB drift detection and deterministic onboarding.
- Upgrade, downgrade, and rollback for every supported module schema version.
- Offline crash/restart, duplicate events, clock skew, expired credentials, full storage, tenant switch, and interrupted migrations.
- WAN outage, provider outage, AP failure, cellular failover, edge loss, printer loss, paper-out, Bluetooth fallback, and uncertain print delivery.
- Provider-local-ID reconciliation, late success, late decline, webhook duplication, and payment queue age/amount limits.

Hardware acceptance uses real iPads, both physical payment readers, both printer paths, the production edge kit, and controlled low-value production transactions. Square offline behavior cannot be certified in Sandbox and therefore requires seller opt-in and controlled production tests.

General-availability criteria:

- Root verification is green with zero warnings and no skipped release integration suite.
- No cross-tenant or cross-franchise data exposure.
- No lost or duplicated order after fault injection and reconciliation.
- Every payment and print job reaches a terminal state or a visible staffed exception.
- Offline receipts never falsely claim settlement.
- Pending provider queues block unsafe logout, deauthorization, or upgrade.
- Backups and restore drills meet a five-minute cloud-data RPO and one-hour RTO.
- Dashboards alert on queue age, reconciliation failures, printer failures, module drift, provider health, and edge health without logging PII.
- Runbooks cover internet loss, AP loss, post-reconnection decline, printer fallback, device replacement, tenant switching, and disaster override.

External release gates remain blocking and cannot be replaced by code:

- Square offline enrollment, application signature, and supported-reader approval.
- Stripe Terminal account/location offline enablement.
- Apple signing, native accessory declarations, store review, and tenant-specific EAS projects only for enabled branded surfaces.
- Production credentials, legal/privacy approval, provider accounts, commercial configuration, store listings, MDM policy, hardware inventory, staff training, and incident contacts.
