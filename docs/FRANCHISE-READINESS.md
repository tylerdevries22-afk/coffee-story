# Franchise readiness — organization/location switcher and the road to industry-neutral

This document preserves the original audit history. Its formerly deferred
production items were completed in the August 31 control-plane pass; the
current operational contract, release gates, and remaining external approvals
are recorded in [FRANCHISE-PRODUCTION.md](./FRANCHISE-PRODUCTION.md).

## What shipped (built and verified)

The HQ console (`apps/hq`) now carries the franchise breadcrumb the operator
portal pioneered: an **Organization** switcher, then a **Location** switcher
for the selected org, in the topbar.

- **Organization = tenant.** Selecting one re-themes and re-titles the whole
  console. In the demo the org list is the tenant registry
  (`apps/hq/lib/tenants.ts`) — Stillpoint Builders (operator), Coffee Story,
  Demo Roastery. In a configured deployment it is the brands the signed-in
  user may read under RLS: every brand for a `platform_admin`, their home
  brand otherwise.
- **Security first.** Selection is a server action
  (`apps/hq/app/actions/workspace.ts`) that re-establishes the session and
  **re-authorizes the posted id against the real set** before writing an
  httpOnly, `SameSite=Lax`, `Secure`-in-prod cookie. A forged or stale cookie
  never grants scope — it fails the shape check (`workspace-cookie.ts`) or the
  membership check (`workspace-scope.ts`) and falls back to the home brand.
  Verified: an unknown `hq_org` falls back to Coffee Story rather than
  erroring or leaking.
- **Route protection.** The middleware remains the console's page-level gate —
  every non-public path redirects to `/login` on a configured deployment, with
  the demo bypass kept only when Supabase env is absent. A new build-time gate
  (`apps/hq/lib/route-protection.test.ts`) fails CI if the public allowlist
  grows, the catch-all redirect is dropped, or the matcher is narrowed to skip
  page routes.
- Green through `pnpm lint`, `pnpm typecheck`, `pnpm test` (260 tests), and
  `pnpm build`.

## Gaps to full production / franchise readiness

### 1. Configured-mode cross-tenant theming and locations
In the demo, switching to another tenant re-themes and lists that tenant's
locations from the registry. Under RLS a `platform_admin` can *list* other
brands (name/id) but cannot read another brand's `brand_config` or `locations`
rows, so in a configured deployment switching to a non-home brand keeps the
home theme and shows no locations.
**To close:** expose a trusted read for platform operators — either a
security-barrier view (`brand_directory` with config + location summaries,
gated on `app.is_platform_admin`) or a platform-API endpoint the console calls
with the service role. Then `workspace-scope.ts` reads locations/config for the
selected org through that path instead of returning `[]`/home config.

### 2. Location scope should filter data, not just the header
The location cookie is resolved and displayed, but the page data layer
(`apps/hq/lib/data.ts`) still reads brand-wide. Franchise operators expect the
selected location to scope KPIs, orders, devices, fees, etc.
**To close:** thread `scope.locationId` into the `load*` queries (a
`.eq('location_id', …)` when set) and into the metric views. RLS already
prevents cross-tenant reads; this is a within-tenant filter for focus, so it is
safe to add incrementally.

### 3. Impersonation audit trail (scope selection closed)
Configured cross-tenant organization and location selections are now audited
before the scope cookie changes. A future "operate as" mutation workflow still
needs to log each privileged write, rather than treating one scope-selection
event as permission for later actions.

## The five apps — switcher UI rollout (UI only, not wired)

The five front ends are `apps/hq`, `apps/customer`, `apps/operator`,
`apps/kiosk`, `apps/display`. Only HQ has the wired switcher. For the others,
the brief is **show the organization dropdown in the header; do not wire the
scope through** yet.

- **operator** already has the real, DB-backed switcher — it is the reference.
- **customer** is white-label, one binary per brand: an org switcher is a
  *demo/preview* affordance only (a guest never switches tenants in
  production). Surface it behind a preview flag; never in a store build.
- **kiosk / display** are single-location devices. An org/location picker
  belongs only in their pairing/preview screens, never in attract/service
  mode.
For each, the reusable piece is the presentation of
`apps/hq/components/workspace-switcher.tsx` (`ScopeSwitcher`) — promote it to a
shared package (see below) rather than copy it per app.

## Industry-neutrality — moving coffee/restaurant specifics into the tenant folder

The engine, schema, and UI kit are already generic; the coffee identity lives
mostly where it should (`tenants/coffee-story/`, and the per-tenant embed at
`apps/customer/src/tenants/<slug>/`). The gaps are the coffee-shaped **demo
fixtures and copy** baked into app code, which make the framework read as
coffee-only:

- `apps/hq/lib/demo-data.ts` — `DEMO_MENU` (Cortado, Oat Latte, V60),
  `DEMO_DROPS`, category names (“Espresso”, “Brew Bar”). Move demo fixtures to
  a tenant-provided `demo.json` so each tenant ships its own preview data.
- Coffee literals appear across app code and tests (`grep -ri` for
  espresso/latte/roast returns ~490 hits, largely fixtures and tests). Inventory
  and relocate the *product* words into tenant data; keep only category-neutral
  scaffolding in app code.
- `SHOP_HOURS` and similar hard-coded hours should come from the tenant’s
  location config, not a source constant.
- Vocabulary: “Menu”, “Barista”, “Shop” in shared chrome should read from the
  brand copy dictionary (`packages/ui/src/copy.ts`) so a builder tenant sees
  “Catalog / Crew / Branch”. Stillpoint Builders in the registry is the test
  case: nothing coffee-specific should render when it is selected.

**Recommended structural step:** promote the switcher presentation and the
scope contract into a shared package (e.g. `packages/data` for
`readWorkspaceScope` shape, `packages/ui` for `ScopeSwitcher`) so all five apps
consume one implementation and the industry-neutral copy flows through the
existing token/copy system.

## Note on the reference implementation

Stillpoint Builders’ operator portal is the source pattern for this switcher
and remains the canonical, DB-backed reference. It was intentionally left
unchanged — porting a foreign tenant into its production switcher would be
incorrect; instead its architecture was mirrored into HQ.

---

# Onboarding deep audit and the self-serve build

A deep audit of how organizations and locations are created (org onboarding,
location creation, and the multi-tenant/RLS layer) produced the findings and
the staged build below.

## Audit findings (why creating orgs/locations was hard)

- **Two disconnected onboarding systems.** A CLI pipeline (`scripts/onboard.ts`
  + `tenants/<slug>/`) actually seeds a brand/menu/first-location into the
  shared DB; an in-app **Platform Factory** (`(console)/onboarding`) provisions
  per-tenant cloud infra but stops at an unimplemented `publish-content` step
  and never writes a brand/location row. Nothing joined them.
- **No in-app "add location" path at all** — no form, no server action; and
  `onboard.ts` reads a *singular* `brand.location`, so there was no supported
  way to add the 2nd/Nth store.
- **The header location switcher didn't scope data** — it re-themed but no query
  filtered KPIs/orders/fees by the selected location.
- **No in-app staff scoping** (`brand_users.location_ids`) — manual SQL + token
  refresh.
- **`workspace-scope` hard-returned `[]` for any non-home brand** in configured
  mode, so a `platform_admin` couldn't drill into a franchisee's stores even
  though RLS permits it; the justifying comments were factually wrong.
- **Industry hard-coded to coffee**; menu authoring is 100% manual
  transcription; identity design is manual.
- **No `brand_directory` view, no cross-tenant access audit trail.**

Foundations (schema, RLS, Square OAuth, device pairing, claims hook) are solid
and location-aware — the gaps were missing product surfaces, not broken plumbing.

## Delivered (built, tested, `pnpm verify` green)

1. **The switcher is now real.** `workspace-scope` resolves orgs from one
   RLS-driven `brands` read (every brand for a platform_admin, home brand
   otherwise) carrying `brand_config` for theming, and reads locations for the
   selected org; the location the header selects now filters data
   (`loadKpis`/`loadFees`) via a server-only cookie reader and a pure,
   unit-tested `scopeRowsToLocation` helper, applied identically to live rows
   and demo fixtures.
2. **Add-Location wizard** (`/locations/new`, `createLocationAction`) —
   brand_owner + platform_admin, blank slate (name/address/hours/timezone
   only). Writes as the signed-in owner (RLS `locations_write` = `is_brand_owner`);
   the target org is the header's, re-authorized against the session. Demo mode
   uses an in-memory per-org store the page and switcher both read.
3. **Create-Organization wizard** (`/organizations/new`,
   `createOrganizationAction`, reachable from the switcher's "New organization"
   row) — platform_admin (matches `brands_insert`), blank-slate/industry-neutral
   brand (`org-input.ts`: name → slug, empty `brand_config` → neutral theme, no
   copy/contact carried over). Switches to the new org and hands off to
   add-location. Demo mode uses an in-memory org store.

**Blank-slate guarantee:** a new org/location carries only what the operator
typed. Neutral theme comes from the token resolver's defaults (no tokens in the
config), never from another tenant; unit tests assert the config has no
`tokens`/`copy`.

## Production-readiness continuation

The remaining plan above is now implemented by the franchise production pass:
review-first PDF/photo/CSV menu ingestion, deterministic logo-to-native assets,
EAS release metadata, staff invitation and location scoping, inline device
pairing, audited operate-as-brand mutations, the per-location fee writer, and
preview-only customer/kiosk/display tenant directories. See
`docs/FRANCHISE-PRODUCTION.md` for the operating contract and external release
evidence that repository code cannot supply.

---

# Autonomous completion pass

Continuing the plan above, the following were researched and built (all behind
`pnpm verify`, green):

- **Location scoping finished where it belongs.** The operations workspace
  (occurrences + schedules) now follows the header location; a codebase audit
  confirmed drops, menu, campaigns, customers have no `location_id` and devices
  are deliberately brand-wide, so those are correctly left alone. KPIs and fees
  were already scoped.
- **Operational add-location chain.** The wizard offers to continue into Square
  consent after creating a store, and the "Add location" button is gated on the
  brand's `multi_location` flag.
- **Menu CSV import** (`/menu/import`) — brand-owner self-serve, RLS-authored,
  idempotent, reusing the shared parser; the concrete slice of "menu import".
- **`brand_directory` view + `platform_access_events` audit log** migration
  (`20260831000000…`), extending the release-readiness chain.
- **Platform access audit wiring.** Configured cross-tenant organization and
  location selections call `record_platform_access` through the engine's
  server-only, retry-safe service-role writer before changing scope. Missing
  actor/env or RPC failure fails closed; home-tenant and unconfigured demo
  selections never touch the audit path.

## Deliberate policy decision

Organization creation remains platform-admin-only. Minting a tenant changes
billing, credential, data-retention, and provider-account boundaries; a brand
owner may administer an existing organization but cannot create a new one.
