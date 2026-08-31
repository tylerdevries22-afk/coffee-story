# Franchise readiness — organization/location switcher and the road to industry-neutral

This document records what shipped in the HQ organization/location switcher
work, and — per the brief — **identifies the remaining gaps without building
them out**, so the platform can be driven from Coffee Story (a fully working
demo) to a franchise-ready, industry-neutral product across all five front
ends.

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

### 3. Impersonation audit trail
When a `platform_admin` acts inside another tenant's org, that crossing should
be audited (who, which brand, when) the way the operator portal logs
privileged actions. No audit row is written today.

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
mostly where it should (`tenants/coffee-story/`, and the per-binary embed at
`apps/customer/src/tenant/`). The gaps are the coffee-shaped **demo fixtures
and copy** baked into app code, which make the framework read as coffee-only:

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
